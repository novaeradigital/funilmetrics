import type pg from "pg";

export async function generateScheduledReport(pool:pg.Pool){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const due=await client.query<{
      id:string;organization_id:string;project_id:string;frequency:"daily"|"weekly";
      period_days:number;scheduled_for:Date;
    }>(`select id,organization_id,project_id,frequency,period_days,
        next_run_at scheduled_for from public.report_schedules
      where enabled and next_run_at<=now() order by next_run_at
      limit 1 for update skip locked`);
    const row=due.rows[0];
    if(!row){await client.query("commit");return {generated:0};}
    const metrics=await client.query<{
      gross_revenue:string;net_revenue:string;approved_payments:number;
      reversed_payments:number;observed_events:number;
    }>(`select coalesce(sum(financial_effect)
          filter(where financial_effect>0),0)::text gross_revenue,
        coalesce(sum(financial_effect),0)::text net_revenue,
        count(distinct payment_id) filter(where financial_effect>0)::int approved_payments,
        count(distinct payment_id) filter(where financial_effect<0)::int reversed_payments,
        count(*)::int observed_events
      from public.normalized_payment_events where project_id=$1
        and data_scope='production'
        and occurred_at>=now()-($2*interval '1 day')`,
    [row.project_id,row.period_days]);
    const inserted=await client.query(`insert into public.report_snapshots(
      organization_id,project_id,schedule_id,scheduled_for,period_days,snapshot)
      values($1,$2,$3,$4,$5,$6::jsonb)
      on conflict(schedule_id,scheduled_for) do nothing returning id`,
    [row.organization_id,row.project_id,row.id,row.scheduled_for,row.period_days,
      JSON.stringify(metrics.rows[0])]);
    await client.query(`update public.report_schedules set last_run_at=now(),
      next_run_at=greatest(now(),$2::timestamptz)+
        case when frequency='daily' then interval '1 day' else interval '7 days' end,
      updated_at=now() where id=$1`,[row.id,row.scheduled_for]);
    await client.query("commit");
    return {generated:inserted.rowCount??0};
  }catch(error){await client.query("rollback");throw error}
  finally{client.release()}
}
