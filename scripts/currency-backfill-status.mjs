import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, max: 1 });
try {
  const status = await pool.query(`
    select conversion_status,count(*)::integer rows,
      coalesce(sum(spend_original),0)::text original_total,
      coalesce(sum(spend_base),0)::text base_total
    from public.meta_ad_insights_daily where spend_original is not null
    group by conversion_status order by conversion_status
  `);
  const runs = await pool.query(`
    select id,status,trigger_kind,rows_considered,rows_converted,rows_pending,rows_failed,
      started_at,completed_at from public.currency_conversion_runs
    order by created_at desc limit 15
  `);
  const futureRates = await pool.query(`
    select count(*)::integer total from public.meta_ad_insights_daily
    where exchange_rate_date>metric_date
  `);
  console.log(JSON.stringify({ status: status.rows, futureRates: futureRates.rows[0].total,
    recentRuns: runs.rows }, null, 2));
} finally { await pool.end(); }
