import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { CREATIVE_MEDIA_POLICY_V1, type CreativeMediaMime } from "@funil-metrics/domain";
import { loadClamAvConfig, scanStreamWithClamAv } from "./clamav-scanner.js";
import {
  loadProjectClamAvConfig,
  loadProjectR2Config,
} from "./integration-credentials.js";
import { loadR2StorageConfig, R2CreativeStorage } from "./r2-storage.js";

type CreativeImportCandidate = {
  id: string;
  job_id: string;
  organization_id: string;
  project_id: string;
  source: "upload" | "drive_link";
  display_name: string;
  mime_type: string | null;
  size_bytes: string | null;
  staging_key: string | null;
  content_sha256: string | null;
  drive_file_id: string | null;
  attempts: number;
  folder_id: string | null;
  requested_by_user_id: string | null;
};

function creativeFormat(mimeType: string) {
  return mimeType in CREATIVE_MEDIA_POLICY_V1.formats
    ? (CREATIVE_MEDIA_POLICY_V1.formats[mimeType as CreativeMediaMime] as {
        outputMime: string;
        maxBytes: number;
        export?: string;
      })
    : null;
}

async function writeStreamToTemp(
  itemId: string,
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
) {
  const directory = join(tmpdir(), "funil-metrics-import");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `generic-${itemId}`);
  const output = createWriteStream(path, { flags: "wx" });
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk as Uint8Array);
      size += buffer.byteLength;
      if (size > maxBytes) throw new Error("file_size_limit_exceeded");
      hash.update(buffer);
      if (!output.write(buffer)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
    if (size === 0) throw new Error("empty_file");
    return { path, size, sha256: hash.digest("hex") };
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
                where status in ('pending', 'downloading', 'scanning', 'failed_retryable')
              )::int as active
         from public.creative_import_items where job_id = $1
     )
     update public.creative_import_jobs job
        set status = (case when totals.active > 0 then 'processing'
                           when totals.failed > 0 then 'completed_with_errors'
                           else 'completed' end),
            finished_at = case when totals.active = 0 then now() else null end
       from totals where job.id = $1`,
    [jobId],
  );
}

async function markFailure(
  pool: pg.Pool,
  candidate: CreativeImportCandidate,
  status: "rejected_format" | "rejected_size" | "failed_retryable" | "failed_terminal",
  code: string,
) {
  const finalStatus =
    status === "failed_retryable" && candidate.attempts >= 5
      ? "failed_terminal"
      : status;
  await pool.query(
    `update public.creative_import_items
        set status = $1, error_code = $2, updated_at = now()
      where id = $3`,
    [finalStatus, code, candidate.id],
  );
  await finishJob(pool, candidate.job_id);
}

export async function processCreativeImports(pool: pg.Pool) {
  const claimed = await pool.query<{ id: string }>(
    `with candidate as (
       select item.id
         from public.creative_import_items item
         join public.creative_import_jobs job on job.id = item.job_id
        where job.status = 'processing'
          and item.status in ('pending', 'failed_retryable')
          and item.attempts < 5
        order by item.created_at
        for update of item skip locked
        limit 1
     )
     update public.creative_import_items item
        set status = 'downloading', attempts = attempts + 1, updated_at = now()
       from candidate where item.id = candidate.id
      returning item.id`,
  );
  if (!claimed.rows[0]) {
    return { claimed: 0, imported: 0, skipped: 0, failed: 0, disabled: false };
  }
  const candidate = (
    await pool.query<CreativeImportCandidate>(
      `select item.id, item.job_id, item.organization_id, item.project_id,
              item.source, item.display_name, item.mime_type,
              item.size_bytes::text, item.staging_key, item.content_sha256,
              item.drive_file_id, item.attempts,
              job.folder_id, job.created_by_user_id as requested_by_user_id
         from public.creative_import_items item
         join public.creative_import_jobs job on job.id = item.job_id
        where item.id = $1`,
      [claimed.rows[0].id],
    )
  ).rows[0]!;
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
  const storage = new R2CreativeStorage(r2Config);
  let temporary: Awaited<ReturnType<typeof writeStreamToTemp>> | undefined;
  let quarantineKey: string | undefined;
  try {
    if (candidate.source === "upload") {
      if (!candidate.staging_key || !candidate.mime_type) {
        await markFailure(pool, candidate, "failed_terminal", "staging_missing");
        return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
      }
      const format = creativeFormat(candidate.mime_type);
      if (!format || format.export) {
        await markFailure(pool, candidate, "rejected_format", "unsupported_format");
        return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
      }
      const body = await storage.getQuarantineObject(candidate.staging_key);
      temporary = await writeStreamToTemp(
        candidate.id,
        body as unknown as AsyncIterable<Uint8Array>,
        format.maxBytes,
      );
      if (candidate.content_sha256 && temporary.sha256 !== candidate.content_sha256) {
        await storage.deleteQuarantineObject(candidate.staging_key);
        await markFailure(pool, candidate, "failed_terminal", "checksum_mismatch");
        return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
      }
      quarantineKey = candidate.staging_key;
    } else {
      const downloaded = await downloadPublicDriveToTemp(candidate);
      temporary = downloaded.temporary;
      if (!candidate.mime_type) candidate.mime_type = downloaded.mimeType;
      if (downloaded.fileName) candidate.display_name = downloaded.fileName;
    }
    const format = creativeFormat(candidate.mime_type ?? "");
    if (!format || format.export) {
      await markFailure(pool, candidate, "rejected_format", "unsupported_format");
      return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
    }
    if (temporary.size > format.maxBytes) {
      await markFailure(pool, candidate, "rejected_size", "file_size_limit_exceeded");
      return { claimed: 1, imported: 0, skipped: 0, failed: 1, disabled: false };
    }
    const existing = await pool.query<{ creative_id: string }>(
      `select creative_id from public.creative_versions
        where project_id = $1 and content_sha256 = $2 limit 1`,
      [candidate.project_id, temporary.sha256],
    );
    if (existing.rows[0]) {
      if (quarantineKey) {
        await storage.deleteQuarantineObject(quarantineKey);
        quarantineKey = undefined;
      }
      await pool.query(
        `update public.creative_import_items
            set status = 'skipped_unchanged', creative_id = $1,
                error_code = null, updated_at = now()
          where id = $2`,
        [existing.rows[0].creative_id, candidate.id],
      );
      await finishJob(pool, candidate.job_id);
      return { claimed: 1, imported: 0, skipped: 1, failed: 0, disabled: false };
    }
    if (!quarantineKey) {
      const quarantine = await storage.putInQuarantine({
        organizationId: candidate.organization_id,
        projectId: candidate.project_id,
        importJobId: candidate.job_id,
        importItemId: candidate.id,
        body: createReadStream(temporary.path),
        mimeType: format.outputMime,
        sizeBytes: temporary.size,
      });
      quarantineKey = quarantine.key;
    }
    await pool.query(
      `update public.creative_import_items set status = 'scanning', updated_at = now()
        where id = $1`,
      [candidate.id],
    );
    const scan = await scanStreamWithClamAv(
      createReadStream(temporary.path),
      clamConfig,
    );
    if (scan.status !== "clean") {
      if (scan.status === "infected") {
        await storage.deleteQuarantineObject(quarantineKey);
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
      quarantineKey,
      organizationId: candidate.organization_id,
      projectId: candidate.project_id,
      contentSha256: temporary.sha256,
      scanStatus: "clean",
    });
    quarantineKey = undefined;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `${candidate.project_id}:${temporary.sha256}`,
      ]);
      const raced = await client.query<{ creative_id: string }>(
        `select creative_id from public.creative_versions
          where project_id = $1 and content_sha256 = $2 limit 1`,
        [candidate.project_id, temporary.sha256],
      );
      if (raced.rows[0]) {
        await client.query(
          `update public.creative_import_items
              set status = 'skipped_unchanged', creative_id = $1,
                  error_code = null, updated_at = now()
            where id = $2`,
          [raced.rows[0].creative_id, candidate.id],
        );
        await client.query("commit");
        await finishJob(pool, candidate.job_id);
        return { claimed: 1, imported: 0, skipped: 1, failed: 0, disabled: false };
      }
      const asset = await client.query<{ id: string }>(
        `insert into public.creative_assets (
           organization_id, project_id, content_sha256, object_key,
           mime_type, size_bytes, malware_status, scanned_at, available_at
         ) values ($1, $2, $3, $4, $5, $6, 'clean', now(), now())
         on conflict (organization_id, project_id, content_sha256)
         do update set malware_status = 'clean', scanned_at = now(),
                       available_at = coalesce(public.creative_assets.available_at, now())
         returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          temporary.sha256,
          promoted.key,
          format.outputMime,
          temporary.size,
        ],
      );
      const creative = await client.query<{ id: string }>(
        `insert into public.creatives (
           organization_id, project_id, name, status, created_by_user_id, folder_id
         ) values ($1, $2, $3, 'imported', $4, $5) returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          candidate.display_name,
          candidate.requested_by_user_id,
          candidate.folder_id,
        ],
      );
      const creativeId = creative.rows[0]!.id;
      const version = await client.query<{ id: string }>(
        `insert into public.creative_versions (
           organization_id, project_id, creative_id, version_number,
           source_drive_file_id, asset_id, source_modified_at, content_sha256
         ) values (
           $1, $2, $3,
           (select coalesce(max(version_number), 0) + 1
              from public.creative_versions where creative_id = $3),
           null, $4, now(), $5
         ) returning id`,
        [
          candidate.organization_id,
          candidate.project_id,
          creativeId,
          asset.rows[0]!.id,
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
        `update public.creative_import_items
            set status = 'imported', asset_id = $1, creative_id = $2,
                display_name = $4, mime_type = $5,
                error_code = null, updated_at = now()
          where id = $3`,
        [
          asset.rows[0]!.id,
          creativeId,
          candidate.id,
          candidate.display_name,
          format.outputMime,
        ],
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
            source: candidate.source,
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
                   'creative_import_item', $4, $5::jsonb)`,
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
  }
}

// Baixa um arquivo publico do Google Drive (link compartilhado) para um
// arquivo temporario. Implementado na leva do link do Drive.
async function downloadPublicDriveToTemp(candidate: CreativeImportCandidate) {
  if (!candidate.drive_file_id) throw new Error("drive_link_not_public");
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", candidate.drive_file_id);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", "t");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error("drive_link_not_public");
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (!contentType || contentType.startsWith("text/html")) {
    throw new Error("drive_link_not_public");
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const nameMatch = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(disposition);
  let fileName: string | undefined;
  try {
    const raw = nameMatch?.[1] ?? nameMatch?.[2];
    if (raw) fileName = decodeURIComponent(raw).slice(0, 240);
  } catch {
    fileName = undefined;
  }
  let mimeType = contentType;
  if (!creativeFormat(mimeType) && fileName) {
    const extension = fileName.includes(".")
      ? fileName.split(".").pop()!.toLowerCase()
      : "";
    const byExtension: Record<string, string> = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
      txt: "text/plain",
    };
    if (byExtension[extension]) mimeType = byExtension[extension]!;
  }
  const format = creativeFormat(mimeType);
  const maxBytes = format ? format.maxBytes : 2 * 1024 ** 3;
  const temporary = await writeStreamToTemp(
    candidate.id,
    response.body as AsyncIterable<Uint8Array>,
    maxBytes,
  );
  return { temporary, mimeType, fileName };
}
