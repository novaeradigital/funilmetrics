import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  const result = await pool.query(`
    select project.id project_id, project.name project_name,
      project.currency base_currency, count(insight.id)::integer legacy_rows,
      min(insight.metric_date)::text first_date,
      max(insight.metric_date)::text last_date,
      count(distinct insight.meta_ad_account_id)::integer account_count,
      count(*) filter (where nullif(account.currency, '') is null)::integer rows_missing_currency,
      count(*) filter (where account.currency_status not in ('confirmed_provider','confirmed_manual'))::integer rows_unconfirmed_currency,
      array_agg(distinct coalesce(account.currency, 'MISSING')) currencies,
      array_agg(distinct account.currency_status) currency_statuses
    from public.meta_ad_insights_daily insight
    join public.projects project on project.id=insight.project_id
    left join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
    where insight.spend_original is null
    group by project.id, project.name, project.currency
    order by legacy_rows desc, project.name
  `);
  const total = result.rows.reduce((sum, row) => sum + Number(row.legacy_rows), 0);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), totalLegacyRows: total,
    projects: result.rows }, null, 2));
} finally {
  await pool.end();
}
