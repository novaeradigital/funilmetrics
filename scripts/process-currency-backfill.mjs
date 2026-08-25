import pg from "pg";
import { processCurrencyConversions } from "../apps/worker/dist/currency-conversion.js";

if (process.env.APPROVE_CURRENCY_BACKFILL !== "APPROVED_2026_08_02") {
  throw new Error("Processamento de backfill não autorizado.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, max: 2 });
try {
  const total = { considered: 0, converted: 0, pending: 0, failed: 0, batches: 0 };
  for (let batch = 0; batch < 30; batch += 1) {
    const result = await processCurrencyConversions(pool, undefined, 100);
    if (!result.considered) break;
    total.batches += 1;
    total.considered += result.considered;
    total.converted += result.converted;
    total.pending += result.pending;
    total.failed += result.failed;
    console.log(JSON.stringify({ event: "currency_backfill_batch", batch: batch + 1, ...result }));
    if (result.converted === 0 && result.failed + result.pending === result.considered) break;
  }
  const remaining = await pool.query(`select count(*)::integer total from public.meta_ad_insights_daily
    where spend_original is not null and conversion_status in ('pending_rate','missing_currency','conversion_error')`);
  const status = Number(remaining.rows[0].total) === 0 ? "completed" : "partial";
  await pool.query(`update public.currency_conversion_runs set status=$1,
    rows_converted=$2,rows_pending=$3,rows_failed=$4,completed_at=now(),updated_at=now()
    where id=(select id from public.currency_conversion_runs
      where trigger_kind='backfill' and status='running' order by created_at desc limit 1)`,
    [status, total.converted, Number(remaining.rows[0].total), total.failed]);
  console.log(JSON.stringify({ event: "currency_backfill_finished", ...total,
    remaining: Number(remaining.rows[0].total), status }));
} finally { await pool.end(); }
