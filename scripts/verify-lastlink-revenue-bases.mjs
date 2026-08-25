import pg from "pg";

const [projectId, from, to] = process.argv.slice(2);
if (!projectId || !from || !to) {
  throw new Error("Uso: node scripts/verify-lastlink-revenue-bases.mjs <project-id> <from-iso> <to-iso>");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  const result = await pool.query(
    `select count(*)::int as events,
            round(sum(sale_financial_effect) filter (where sale_financial_effect > 0), 2) as sale_total,
            round(sum(producer_commission_financial_effect) filter (
              where producer_commission_financial_effect > 0
            ), 2) as producer_total,
            count(*) filter (where sale_financial_effect <> 0)::int as eligible_events,
            count(*) filter (
              where sale_financial_effect <> 0 and commission_data_status = 'missing'
            )::int as eligible_missing
       from normalized_payment_events
      where project_id = $1
        and occurred_at >= $2::timestamptz
        and occurred_at < $3::timestamptz`,
    [projectId, from, to],
  );
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
} finally {
  await pool.end();
}
