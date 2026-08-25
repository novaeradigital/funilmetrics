import { randomUUID } from "node:crypto";
import pg from "pg";

const sourceJobId = process.argv[2]?.trim();
if (!sourceJobId || !process.env.DATABASE_URL) {
  throw new Error("Uso: npm run drive:inventory:retry -- <job-id>");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const client = await pool.connect();
try {
  await client.query("begin");
  const source = await client.query(
    `select id, organization_id, project_id, drive_folder_id,
            requested_by_user_id, status
       from public.drive_import_jobs
      where id = $1
      for update`,
    [sourceJobId],
  );
  const job = source.rows[0];
  if (!job) throw new Error("drive_inventory_job_not_found");
  if (!["failed", "completed"].includes(job.status)) {
    throw new Error("drive_inventory_job_not_retryable");
  }
  await client.query(
    "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    [job.project_id, job.drive_folder_id],
  );
  const active = await client.query(
    `select id from public.drive_import_jobs
      where drive_folder_id = $1
        and status in ('pending', 'inventorying', 'importing')
      limit 1`,
    [job.drive_folder_id],
  );
  if (active.rows[0]) {
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ jobId: active.rows[0].id, duplicate: true })}\n`);
  } else {
    const retried = await client.query(
      `insert into public.drive_import_jobs (
         organization_id, project_id, drive_folder_id,
         requested_by_user_id, idempotency_key
       ) values ($1, $2, $3, $4, $5)
       returning id`,
      [
        job.organization_id,
        job.project_id,
        job.drive_folder_id,
        job.requested_by_user_id,
        `manual-retry:${job.id}:${randomUUID()}`,
      ],
    );
    const retriedId = retried.rows[0].id;
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       ) values ($1, $2, $3, 'drive_inventory_retried',
                 'drive_import_job', $4, $5::jsonb)`,
      [
        job.organization_id,
        job.project_id,
        job.requested_by_user_id,
        retriedId,
        JSON.stringify({
          folderId: job.drive_folder_id,
          retryOf: job.id,
          mode: "manual_recovery",
        }),
      ],
    );
    await client.query("commit");
    process.stdout.write(`${JSON.stringify({ jobId: retriedId, retryOf: job.id })}\n`);
  }
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  client.release();
  await pool.end();
}
