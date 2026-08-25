import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  const result = await pool.query(`
    update public.meta_sync_runs
       set status='queued',attempts=0,error_code=null,next_attempt_at=now(),
           started_at=null,finished_at=null,updated_at=now()
     where id=(
       select id from public.meta_sync_runs
        where status in ('failed_terminal','failed_retryable')
        order by created_at desc limit 1
     )
     returning id,status
  `);
  console.log(JSON.stringify({ retried: result.rowCount ?? 0, run: result.rows[0] }));
} finally {
  await pool.end();
}
