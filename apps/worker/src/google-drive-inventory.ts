import { createDecipheriv } from "node:crypto";
import type pg from "pg";
import {
  CREATIVE_MEDIA_POLICY_V1,
} from "@funil-metrics/domain";
import {
  loadProjectGoogleDriveAppConfig,
  type GoogleDriveAppConfig,
} from "./integration-credentials.js";

const folderMimeType = "application/vnd.google-apps.folder";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  modifiedTime: string;
  md5Checksum?: string;
  trashed?: boolean;
};

export type InventoryCandidate = {
  id: string;
  organization_id: string;
  project_id: string;
  drive_folder_id: string;
  external_folder_id: string;
  include_subfolders: boolean;
  drive_connection_id: string;
  credential_secret_ref: string;
  ciphertext: Buffer;
  initialization_vector: Buffer;
  authentication_tag: Buffer;
};

export function isSupportedCreativeMime(mimeType: string) {
  return mimeType in CREATIVE_MEDIA_POLICY_V1.formats;
}

export function validateImportExecution(files: DriveFile[]) {
  if (files.length > CREATIVE_MEDIA_POLICY_V1.execution.maxFiles) {
    return "execution_file_limit_exceeded";
  }
  const knownBytes = files.reduce(
    (total, file) => {
      const format =
        CREATIVE_MEDIA_POLICY_V1.formats[
          file.mimeType as keyof typeof CREATIVE_MEDIA_POLICY_V1.formats
        ];
      return total + (file.size ? Number(file.size) : format?.maxBytes ?? 0);
    },
    0,
  );
  if (knownBytes > CREATIVE_MEDIA_POLICY_V1.execution.maxBytes) {
    return "execution_size_limit_exceeded";
  }
  return null;
}

function decryptRefreshToken(candidate: InventoryCandidate, key: Buffer) {
  if (key.length !== 32) throw new Error("google_encryption_key_invalid");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    candidate.initialization_vector,
  );
  decipher.setAuthTag(candidate.authentication_tag);
  return Buffer.concat([
    decipher.update(candidate.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function legacyGoogleDriveAppConfig(): GoogleDriveAppConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const encodedKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !encodedKey) return null;
  return {
    clientId,
    clientSecret,
    refreshTokenEncryptionKey: Buffer.from(encodedKey, "base64"),
  };
}

export async function getGoogleAccessToken(
  pool: pg.Pool,
  candidate: InventoryCandidate,
) {
  const config =
    (await loadProjectGoogleDriveAppConfig(pool, candidate.project_id)) ??
    legacyGoogleDriveAppConfig();
  if (!config) throw new Error("google_oauth_missing");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptRefreshToken(
        candidate,
        config.refreshTokenEncryptionKey,
      ),
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("google_refresh_failed");
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("google_refresh_invalid");
  return body.access_token;
}

export async function listDriveFolder(
  folderId: string,
  token: string,
  request: typeof fetch = fetch,
) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`);
    url.searchParams.set(
      "fields",
      "nextPageToken,files(id,name,mimeType,parents,size,modifiedTime,md5Checksum,trashed)",
    );
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await request(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("drive_list_failed");
    const page = (await response.json()) as {
      files?: DriveFile[];
      nextPageToken?: string;
    };
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

async function inventoryCandidate(pool: pg.Pool, candidate: InventoryCandidate) {
  const token = await getGoogleAccessToken(pool, candidate);
  const queue = [candidate.external_folder_id];
  const visited = new Set<string>();
  const discovered: DriveFile[] = [];
  const mimeCounts = new Map<string, number>();
  let scanned = 0;
  while (queue.length) {
    const folderId = queue.shift()!;
    if (visited.has(folderId)) continue;
    visited.add(folderId);
    const children = await listDriveFolder(folderId, token);
    scanned += children.length;
    for (const child of children) {
      mimeCounts.set(
        child.mimeType,
        (mimeCounts.get(child.mimeType) ?? 0) + 1,
      );
      if (child.mimeType === folderMimeType) {
        if (candidate.include_subfolders) queue.push(child.id);
      } else if (isSupportedCreativeMime(child.mimeType)) {
        discovered.push(child);
      }
    }
  }
  const executionError = validateImportExecution(discovered);

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const file of discovered) {
      const previous=await client.query<{
        id:string;external_parent_id:string|null;modified_at_source:Date;
        source_checksum:string|null;status:string;
      }>(`select id,external_parent_id,modified_at_source,source_checksum,status::text
          from public.drive_files where drive_folder_id=$1 and external_file_id=$2
          for update`,[candidate.drive_folder_id,file.id]);
      const before=previous.rows[0];
      const stored = await client.query<{ id: string }>(
        `insert into public.drive_files (
           organization_id, project_id, drive_folder_id, external_file_id,
           external_parent_id, name, mime_type, size_bytes,
           modified_at_source, source_checksum
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (drive_folder_id, external_file_id)
         do update set external_parent_id = excluded.external_parent_id,
                       name = excluded.name,
                       mime_type = excluded.mime_type,
                       size_bytes = excluded.size_bytes,
                       modified_at_source = excluded.modified_at_source,
                       source_checksum = excluded.source_checksum,
                       status = 'active', last_seen_at = now(),
                       removed_at = null, updated_at = now()
         returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          candidate.drive_folder_id,
          file.id,
          file.parents?.[0] ?? null,
          file.name,
          file.mimeType,
          file.size ? Number(file.size) : null,
          file.modifiedTime,
          file.md5Checksum ?? null,
        ],
      );
      const changeType=!before?"new":before.status==="removed"?"restored":
        before.external_parent_id!==(file.parents?.[0]??null)?"moved":
        before.source_checksum!==(file.md5Checksum??null) ||
        before.modified_at_source.toISOString()!==new Date(file.modifiedTime).toISOString()
          ?"modified":null;
      if(changeType){
        await client.query(
          `insert into public.drive_change_records(organization_id,project_id,
           drive_folder_id,drive_file_id,external_file_id,change_type,
           source_modified_at,evidence) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [candidate.organization_id,candidate.project_id,candidate.drive_folder_id,
           stored.rows[0]!.id,file.id,changeType,file.modifiedTime,
           JSON.stringify({inventoryJobId:candidate.id})],
        );
      }
      await client.query(
        `insert into public.drive_import_items (
           organization_id, project_id, job_id, drive_file_id
         ) values ($1, $2, $3, $4)
         on conflict (job_id, drive_file_id) do nothing`,
        [
          candidate.organization_id,
          candidate.project_id,
          candidate.id,
          stored.rows[0]!.id,
        ],
      );
    }
    const discoveredIds=discovered.map((file)=>file.id);
    const removed=await client.query<{id:string;external_file_id:string}>(
      `update public.drive_files set status='removed',removed_at=now(),updated_at=now()
       where drive_folder_id=$1 and status='active'
         and not(external_file_id=any($2::text[]))
       returning id,external_file_id`,
      [candidate.drive_folder_id,discoveredIds],
    );
    for(const file of removed.rows){
      await client.query(
        `insert into public.drive_change_records(organization_id,project_id,
         drive_folder_id,drive_file_id,external_file_id,change_type,evidence,processed_at)
         values($1,$2,$3,$4,$5,'removed',$6::jsonb,now())`,
        [candidate.organization_id,candidate.project_id,candidate.drive_folder_id,
         file.id,file.external_file_id,JSON.stringify({inventoryJobId:candidate.id})],
      );
    }
    await client.query(
      `update public.drive_import_jobs
          set status = $1::public.drive_import_job_status, files_detected = $2,
              error_code = $3,
               finished_at = now(), updated_at = now()
        where id = $4`,
      [
        executionError ? "failed" : "completed",
        discovered.length,
        executionError,
        candidate.id,
      ],
    );
    await client.query(
      `update public.drive_folders
          set last_inventory_at = now(), status = 'active', updated_at = now()
        where id = $1`,
      [candidate.drive_folder_id],
    );
    await client.query("commit");
    return {
      detected: discovered.length,
      scanned,
      foldersVisited: visited.size,
      mimeCounts: Object.fromEntries([...mimeCounts].sort()),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function processGoogleDriveInventory(pool: pg.Pool) {
  const claimed = await pool.query<InventoryCandidate>(
    `with candidate as (
       select job.id
         from public.drive_import_jobs job
        where job.status = 'pending'
        order by job.created_at
        for update skip locked
        limit 1
     )
     update public.drive_import_jobs job
        set status = 'inventorying', started_at = now(), updated_at = now()
       from candidate
      where job.id = candidate.id
      returning job.id, job.organization_id, job.project_id,
                job.drive_folder_id`,
  );
  const base = claimed.rows[0];
  if (!base) return { claimed: 0, detected: 0, failed: 0 };
  const details = await pool.query<InventoryCandidate>(
    `select job.id, job.organization_id, job.project_id,
            job.drive_folder_id, folder.drive_folder_id as external_folder_id,
            folder.include_subfolders, folder.drive_connection_id,
            drive.credential_secret_ref, secret.ciphertext,
            secret.initialization_vector, secret.authentication_tag
       from public.drive_import_jobs job
       join public.drive_folders folder on folder.id = job.drive_folder_id
       join public.drive_connections drive on drive.id = folder.drive_connection_id
       join public.integration_secrets secret
         on secret.id = drive.credential_secret_ref
      where job.id = $1 and drive.disconnected_at is null
        and folder.status = 'active' and secret.rotated_at is null`,
    [base.id],
  );
  const candidate = details.rows[0];
  if (!candidate) {
    await pool.query(
      `update public.drive_import_jobs
          set status = 'failed', error_code = 'drive_authorization_unavailable',
              finished_at = now(), updated_at = now()
        where id = $1`,
      [base.id],
    );
    return { claimed: 1, detected: 0, failed: 1 };
  }
  try {
    const inventory = await inventoryCandidate(pool, candidate);
    return { claimed: 1, ...inventory, failed: 0 };
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "drive_inventory_failed";
    await pool.query(
      `update public.drive_import_jobs
          set status = 'failed', error_code = $1,
              finished_at = now(), updated_at = now()
        where id = $2`,
      [code, base.id],
    );
    return { claimed: 1, detected: 0, failed: 1 };
  }
}
