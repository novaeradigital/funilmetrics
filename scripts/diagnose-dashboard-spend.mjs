import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false"
    ? {rejectUnauthorized: false}
    : undefined,
});

try {
  const result = await pool.query(`
    select project.name as project,
           insight.metric_date::text as metric_date,
           insight.conversion_status,
           count(*)::int as rows,
           coalesce(sum(insight.spend_original),0)::text as spend_original,
           coalesce(sum(insight.spend_base),0)::text as spend_base,
           min(insight.original_currency) as original_currency,
           min(insight.base_currency) as base_currency,
           max(insight.updated_at) as last_updated_at
      from public.meta_ad_insights_daily insight
      join public.projects project on project.id=insight.project_id
     where insight.metric_date >= (current_date - interval '7 days')::date
     group by project.name,insight.metric_date,insight.conversion_status
     order by project.name,insight.metric_date desc,insight.conversion_status
  `);
  console.log(JSON.stringify(result.rows));
} finally {
  await pool.end();
}
