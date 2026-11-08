import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import {CREATIVE_MEDIA_POLICY_V1,creativeDisplayNameFromFileName,type CreativeMediaMime} from "@funil-metrics/domain";
import { loadClamAvConfig, scanStreamWithClamAv } from "./clamav-scanner.js";
import { getGoogleAccessToken } from "./google-drive-inventory.js";
import {
  loadProjectClamAvConfig,
  loadProjectR2Config,
} from "./integration-credentials.js";
import { loadR2StorageConfig, R2CreativeStorage } from "./r2-storage.js";

type ImportCandidate = {
  id: string;
  job_id: string;
  organization_id: string;
  project_id: string;
  drive_file_id: string;
  external_file_id: string;
  name: string;
  mime_type: string;
  size_bytes: string | null;
  modified_at_source: Date;
  requested_by_user_id: string;
  ciphertext: Buffer;
  initialization_vector: Buffer;
  authentication_tag: Buffer;
  external_folder_id: string;
  drive_folder_id: string;
  include_subfolders: boolean;
  drive_connection_id: string;
  credential_secret_ref: string;
  attempts: number;
};

export function creativeFormat(mimeType: string) {
  return mimeType in CREATIVE_MEDIA_POLICY_V1.formats
    ?CREATIVE_MEDIA_POLICY_V1.formats[mimeType as CreativeMediaMime] as {
      outputMime:string;maxBytes:number;export?:string;
    }:null;
}

async function downloadToTemp(candidate: ImportCandidate, accessToken: string) {
  const format = creativeFormat(candidate.mime_type);
  if (!format) throw new Error("unsupported_format");
  if (candidate.size_bytes && Number(candidate.size_bytes) > format.maxBytes) {
    throw new Error("file_size_limit_exceeded");
  }
  const url = format.export
    ? new URL(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(candidate.external_file_id)}/export`,
      )
    : new URL(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(candidate.external_file_id)}`,
      );
  if (format.export) url.searchParams.set("mimeType", format.export);
  else url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok || !response.body) throw new Error("drive_download_failed");
  const directory = join(tmpdir(), "funil-metrics-import");
  await mkdir(directory, { recursive: true });
  const path = join(directory, candidate.id);
  const output = createWriteStream(path, { flags: "wx" });
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > format.maxBytes) throw new Error("file_size_limit_exceeded");
      hash.update(buffer);
      if (!output.write(buffer)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
    if (size === 0) throw new Error("empty_file");
    return {
      path,
      size,
      sha256: hash.digest("hex"),
      mimeType: format.outputMime,
    };
  } catch (error) {
    output.destroy();
    await rm(path, { force: true });
    throw error;
  }
}

async function finishJob(pool: pg.Pool, jobId: string) {
  await pool.query(
    `with totals as (
       select count(*) filter (where status = 'imported')::int as imported,
              count(*) filter (where status = 'skipped_unchanged')::int as skipped,
              count(*) filter (
                where status in ('rejected_format', 'rejected_size', 'failed_terminal')
              )::int as failed,
              count(*) filter (
                where status in ('pending', 'downloading', 'quarantined',
                                 'scanning', 'failed_retryable')
              )::int as active
         from public.drive_import_items where job_id = $1
     )
     update public.drive_import_jobs job
        set files_imported = totals.imported,
            files_skipped = totals.skipped,
            files_failed = totals.failed,
            status = (case when totals.active > 0 then 'importing'
                           when totals.failed > 0 then 'completed_with_errors'
                           else 'completed' end)::public.drive_import_job_status,
            finished_at = case when totals.active = 0 then now() else null end,
            updated_at = now()
       from totals where job.id = $1`,
    [jobId],
  );
}

async function markFailure(
  pool: pg.Pool,
  candidate: ImportCandidate,
  status: "rejected_format" | "rejected_size" | "failed_retryable" | "failed_terminal",
  code: string,
) {
  const finalStatus =
    status === "failed_retryable" && candidate.attempts >= 5
      ? "failed_terminal"
      : status;
  await pool.query(
    `update public.drive_import_items
        set status = $1, error_code = $2, updated_at = now()
      where id = $3`,
    [finalStatus, code, candidate.id],
  );
  await finishJob(pool, candidate.job_id);
}

export async function processGoogleDriveImport(pool: pg.Pool) {
  const claimed = await pool.query<{ id: string }>(
    `with candidate as (
       select item.id
         from public.drive_import_items item
         join public.drive_import_jobs job on job.id = item.job_id
        where job.status = 'importing'
          and item.status in ('pending', 'failed_retryable')
          and item.attempts < 5
        order by item.created_at
        for update of item skip locked
        limit 1
     )
     update public.drive_import_items item
        set status = 'downloading', attempts = attempts + 1, updated_at = now()
       from candidate where item.id = candidate.id
      returning item.id`,
  );
  if (!claimed.rows[0]) {
    return { claimed: 0, imported: 0, skipped: 0, failed: 0, disabled: false };
  }
  const result = await pool.query<ImportCandidate>(
    `select item.id, item.job_id, item.organization_id, item.project_id,
            item.drive_file_id, item.attempts, file.external_file_id, file.name,
            file.mime_type, file.size_bytes::text, file.modified_at_source,
            job.requested_by_user_id, folder.drive_folder_id as external_folder_id,
            folder.id as drive_folder_id, folder.include_subfolders,
            folder.drive_connection_id, drive.credential_secret_ref,
            secret.ciphertext, secret.initialization_vector,
            secret.authentication_tag
       from public.drive_import_items item
       join public.drive_import_jobs job on job.id = item.job_id
       join public.drive_files file on file.id = item.drive_file_id
       join public.drive_folders folder on folder.id = file.drive_folder_id
       join public.drive_connections drive on drive.id = folder.drive_connection_id
       join public.integration_secrets secret on secret.id = drive.credential_secret_ref
      where item.id = $1 and drive.disconnected_at is null
        and secret.rotated_at is null`,
    [claimed.rows[0].id],
  );
  const candidate = result.rows[0];
  if (!candidate) {
    await pool.query(
      `update public.drive_import_items
          set status = 'failed_terminal',
              error_code = 'drive_authorization_unavailable', updated_at = now()
        where id = $1`,
      [claimed.rows[0].id],
    );
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
  }
  let r2Config;
  let clamConfig;
  try {
    r2Config =
      (await loadProjectR2Config(pool, candidate.project_id)) ??
      loadR2StorageConfig();
    clamConfig =
      (await loadProjectClamAvConfig(pool, candidate.project_id)) ??
      loadClamAvConfig();
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "integration_configuration_failed";
    await markFailure(pool, candidate, "failed_retryable", code);
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: true };
  }
  if (!r2Config || !clamConfig) {
    await markFailure(
      pool,
      candidate,
      "failed_retryable",
      !r2Config ? "r2_not_configured" : "clamav_not_configured",
    );
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: true };
  }
  const format = creativeFormat(candidate.mime_type);
  if (!format) {
    await markFailure(pool, candidate, "rejected_format", "unsupported_format");
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
  }
  if (candidate.size_bytes && Number(candidate.size_bytes) > format.maxBytes) {
    await markFailure(pool, candidate, "rejected_size", "file_size_limit_exceeded");
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
  }

  let temporary: Awaited<ReturnType<typeof downloadToTemp>> | undefined;
  let quarantineKey: string | undefined;
  const storage = new R2CreativeStorage(r2Config);
  try {
    const token = await getGoogleAccessToken(pool, candidate);
    temporary = await downloadToTemp(candidate, token);
    const existing = await pool.query<{ id: string }>(
      `select id from public.creative_versions
        where source_drive_file_id = $1 and content_sha256 = $2 limit 1`,
      [candidate.drive_file_id, temporary.sha256],
    );
    if (existing.rows[0]) {
      await pool.query(`with item as (
        update public.drive_import_items set status='skipped_unchanged',updated_at=now()
        where id=$1 returning drive_file_id)
        update public.drive_change_records change set processed_at=now()
        from item where change.drive_file_id=item.drive_file_id and change.processed_at is null`,
        [candidate.id]);
      await finishJob(pool, candidate.job_id);
      return { claimed: 1, imported: 0, skipped: 1, failed: 0, disabled: false };
    }
    const quarantine = await storage.putInQuarantine({
      organizationId: candidate.organization_id,
      projectId: candidate.project_id,
      importJobId: candidate.job_id,
      importItemId: candidate.id,
      body: createReadStream(temporary.path),
      mimeType: temporary.mimeType,
      sizeBytes: temporary.size,
    });
    quarantineKey = quarantine.key;
    await pool.query(
      `update public.drive_import_items set status = 'scanning', updated_at = now()
        where id = $1`,
      [candidate.id],
    );
    const scan = await scanStreamWithClamAv(
      createReadStream(temporary.path),
      clamConfig,
    );
    if (scan.status !== "clean") {
      if (scan.status === "infected") {
        await storage.deleteQuarantineObject(quarantine.key);
        quarantineKey = undefined;
        await markFailure(pool, candidate, "failed_terminal", "malware_detected");
      } else if (scan.status === "unsupported") {
        await markFailure(pool, candidate, "failed_terminal", "malware_scan_unsupported");
      } else {
        await markFailure(pool, candidate, "failed_retryable", scan.code);
      }
      return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
    }
    const promoted = await storage.promoteCleanObject({
      quarantineKey: quarantine.key,
      organizationId: candidate.organization_id,
      projectId: candidate.project_id,
      contentSha256: temporary.sha256,
      scanStatus: "clean",
    });
    quarantineKey = undefined;
    const client = await pool.connect();
    try {
      await client.query("begin");
      const asset = await client.query<{ id: string }>(
        `insert into public.creative_assets (
           organization_id, project_id, content_sha256, object_key,
           mime_type, size_bytes, malware_status, scanned_at, available_at
         ) values ($1, $2, $3, $4, $5, $6, 'clean', now(), now())
         on conflict (organization_id, project_id, content_sha256)
         do update set malware_status = 'clean', scanned_at = now(),
                       available_at = coalesce(creative_assets.available_at, now())
         returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          temporary.sha256,
          promoted.key,
          temporary.mimeType,
          temporary.size,
        ],
      );
      const existingCreative = await client.query<{ id: string }>(
        `select version.creative_id as id
           from public.creative_versions version
          where version.source_drive_file_id = $1
          order by version.version_number desc limit 1`,
        [candidate.drive_file_id],
      );
      let creativeId = existingCreative.rows[0]?.id;
      if (!creativeId) {
        const creative = await client.query<{ id: string }>(
          `insert into public.creatives (
             organization_id, project_id, name, status, created_by_user_id
           ) values ($1, $2, $3, 'imported', $4) returning id`,
          [
            candidate.organization_id,
            candidate.project_id,
            creativeDisplayNameFromFileName(candidate.name),
            candidate.requested_by_user_id,
          ],
        );
        creativeId = creative.rows[0]!.id;
      }
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        creativeId,
      ]);
      const version = await client.query<{ id: string }>(
        `insert into public.creative_versions (
           organization_id, project_id, creative_id, version_number,
           source_drive_file_id, asset_id, source_modified_at, content_sha256
         ) values (
           $1, $2, $3,
           (select coalesce(max(version_number), 0) + 1
              from public.creative_versions where creative_id = $3),
           $4, $5, $6, $7
         ) returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          creativeId,
          candidate.drive_file_id,
          asset.rows[0]!.id,
          candidate.modified_at_source,
          temporary.sha256,
        ],
      );
      await client.query(
        `update public.creatives
            set current_version_id = $1, status = 'imported', updated_at = now()
          where id = $2`,
        [version.rows[0]!.id, creativeId],
      );
      await client.query(
        `update public.drive_import_items
            set status = 'imported', asset_id = $1, creative_version_id = $2,
                error_code = null, updated_at = now()
          where id = $3`,
        [asset.rows[0]!.id, version.rows[0]!.id, candidate.id],
      );
      await client.query(
        `update public.drive_change_records set processed_at=now()
         where drive_file_id=$1 and processed_at is null`,
        [candidate.drive_file_id],
      );
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1, $2, $3, 'creative_version_created',
                   'creative_version', $4, $5::jsonb)`,
        [
          candidate.organization_id,
          candidate.project_id,
          candidate.requested_by_user_id,
          version.rows[0]!.id,
          JSON.stringify({
            creativeId,
            driveFileId: candidate.drive_file_id,
            contentSha256: temporary.sha256,
            malwareStatus: "clean",
          }),
        ],
      );
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1, $2, $3, 'creative_file_imported',
                   'drive_import_item', $4, $5::jsonb)`,
        [
          candidate.organization_id,
          candidate.project_id,
          candidate.requested_by_user_id,
          candidate.id,
          JSON.stringify({
            creativeId,
            creativeVersionId: version.rows[0]!.id,
            assetId: asset.rows[0]!.id,
          }),
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await finishJob(pool, candidate.job_id);
    return { claimed: 1, imported: 1, skipped: 0, failed: 0, disabled: false };
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "creative_import_failed";
    await markFailure(
      pool,
      candidate,
      code === "file_size_limit_exceeded" ? "rejected_size" : "failed_retryable",
      code,
    );
    return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
  } finally {
    if (temporary) await rm(temporary.path, { force: true });
    if (quarantineKey?.startsWith("quarantine/")) {
      // Falhas recuperáveis preservam a quarentena privada para diagnóstico.
    }
  }
}
