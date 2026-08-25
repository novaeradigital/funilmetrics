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
  const [runs, totals] = await Promise.all([
    pool.query(`
      select id,status,error_code,attempts,account_count,campaign_count,
             ad_set_count,ad_count,creative_count,insight_count,
             scheduled_for,started_at,finished_at
        from public.meta_sync_runs
       order by created_at desc
       limit 5
    `),
    pool.query(`
      select count(*)::int insight_rows,
             coalesce(sum(spend),0)::text spend,
             coalesce(sum(impressions),0)::text impressions,
             coalesce(sum(clicks),0)::text clicks,
             min(metric_date) min_date,max(metric_date) max_date
        from public.meta_ad_insights_daily
    `),
  ]);
  console.log(JSON.stringify({ runs: runs.rows, totals: totals.rows[0] }));
} finally {
  await pool.end();
}
