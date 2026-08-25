import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, max: 1 });
try {
  const summary = await pool.query(`
    select count(*)::integer total_rows,
      count(*) filter (where conversion_status='converted')::integer converted_rows,
      count(*) filter (where conversion_status<>'converted')::integer blocked_rows,
      sum(spend_original)::text original_usd_total,sum(spend_base)::text base_brl_total,
      min(exchange_rate_date)::text first_rate_date,max(exchange_rate_date)::text last_rate_date,
      count(*) filter (where exchange_rate_date>metric_date)::integer future_rate_rows,
      count(*) filter (where exchange_rate_date<metric_date)::integer prior_business_day_rows,
      count(*) filter (where exchange_rate_source<>'bcb-ptax')::integer non_bcb_rows,
      count(*) filter (where abs(spend_base-round(spend_original*exchange_rate,6))>0.000001)::integer reconciliation_errors
    from public.meta_ad_insights_daily where spend_original is not null
  `);
  const sample = await pool.query(`
    select metric_date::text,spend_original::text,original_currency,
      exchange_rate::text,exchange_rate_date::text,exchange_rate_source,
      spend_base::text,base_currency,conversion_status
    from public.meta_ad_insights_daily where spend_original is not null
    order by metric_date,spend_original desc limit 10
  `);
  console.log(JSON.stringify({ summary: summary.rows[0], sample: sample.rows }, null, 2));
} finally { await pool.end(); }
