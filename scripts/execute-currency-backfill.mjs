import pg from "pg";

if (process.env.APPROVE_CURRENCY_BACKFILL !== "APPROVED_2026_08_02") {
  throw new Error("Backfill não autorizado nesta execução.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não configurada.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, max: 1 });
const client = await pool.connect();
try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext('currency-backfill-v1'))");
  const inventory = await client.query(`
    select count(*)::integer total,
      count(*) filter (where nullif(account.currency,'') is null)::integer missing_currency,
      count(*) filter (where account.currency_status not in ('confirmed_provider','confirmed_manual'))::integer unconfirmed_currency
    from public.meta_ad_insights_daily insight
    left join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
    where insight.spend_original is null
  `);
  const summary = inventory.rows[0];
  if (!summary?.total) throw new Error("Nenhuma linha legada pendente.");
  if (summary.missing_currency || summary.unconfirmed_currency) {
    throw new Error(`Pré-condição cambial inválida: ${JSON.stringify(summary)}`);
  }
  const samples = await client.query(`
    select insight.metric_date::text metric_date,insight.spend::text spend_original,
      account.currency original_currency,project.currency base_currency
    from public.meta_ad_insights_daily insight
    join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
    join public.projects project on project.id=insight.project_id
    where insight.spend_original is null
    order by insight.metric_date,abs(insight.spend) desc limit 10
  `);
  const project = await client.query(`
    select insight.organization_id,insight.project_id
    from public.meta_ad_insights_daily insight where insight.spend_original is null
    group by insight.organization_id,insight.project_id
  `);
  if (project.rowCount !== 1) throw new Error("Backfill deve operar em exatamente um projeto por execução.");
  const target = project.rows[0];
  const run = await client.query(`
    insert into public.currency_conversion_runs(organization_id,project_id,status,trigger_kind,
      rule_version,rows_considered,started_at)
    values($1,$2,'running','backfill','fx-v1-ptax-closing-sale',$3,now()) returning id
  `,[target.organization_id,target.project_id,summary.total]);
  const released = await client.query(`
    update public.meta_ad_insights_daily insight set
      spend_original=insight.spend,original_currency=account.currency,
      conversion_status='pending_rate',conversion_error_code=null,updated_at=now()
    from public.meta_ad_accounts account
    where account.id=insight.meta_ad_account_id and insight.spend_original is null
      and account.currency_status in ('confirmed_provider','confirmed_manual')
      and nullif(account.currency,'') is not null
  `);
  await client.query(`
    insert into public.audit_logs(organization_id,project_id,action,target_type,target_id,reason,metadata)
    values($1,$2,'currency_backfill_approved','currency_conversion_run',$3,
      'Aprovado explicitamente pelo proprietário em 2026-08-02',
      $4::jsonb)
  `,[target.organization_id,target.project_id,run.rows[0].id,
    JSON.stringify({ approvedRows: summary.total, releasedRows: released.rowCount,
      ruleVersion: "fx-v1-ptax-closing-sale", sample: samples.rows })]);
  await client.query("commit");
  console.log(JSON.stringify({ runId: run.rows[0].id, releasedRows: released.rowCount,
    sample: samples.rows }, null, 2));
} catch (error) {
  await client.query("rollback"); throw error;
} finally { client.release(); await pool.end(); }
