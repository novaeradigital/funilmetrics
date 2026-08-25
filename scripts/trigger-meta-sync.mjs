import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, max: 1 });
try {
  const result = await pool.query(`
    update public.meta_sync_schedules schedule set next_run_at=now(),updated_at=now()
    from public.connections connection,public.meta_authorizations authz
    where connection.id=schedule.connection_id
      and authz.connection_id=connection.id
      and schedule.enabled and connection.provider='meta_ads'
      and connection.status='active' and authz.status='active'
    returning schedule.id,schedule.project_id
  `);
  console.log(JSON.stringify({ schedulesTriggered: result.rowCount, schedules: result.rows }));
} finally { await pool.end(); }
