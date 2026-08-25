import type pg from "pg";

export function metaSyncIdempotencyKey(scheduleId:string,scheduledFor:Date){
  return `meta-sync:${scheduleId}:${scheduledFor.toISOString()}`;
}

export async function scheduleMetaSync(pool:pg.Pool){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const due=await client.query<{
      id:string;organization_id:string;project_id:string;connection_id:string;
      interval_minutes:number;scheduled_for:Date;
    }>(
      `select schedule.id,schedule.organization_id,schedule.project_id,
              schedule.connection_id,schedule.interval_minutes,
              schedule.next_run_at scheduled_for
         from public.meta_sync_schedules schedule
         join public.connections connection
           on connection.id=schedule.connection_id
          and connection.organization_id=schedule.organization_id
          and connection.project_id=schedule.project_id
         join public.meta_authorizations authz
           on authz.connection_id=connection.id
        where schedule.enabled and schedule.next_run_at<=now()
          and connection.provider='meta_ads' and connection.status='active'
          and authz.status='active'
        order by schedule.next_run_at
        limit 1 for update of schedule skip locked`,
    );
    const row=due.rows[0];
    if(!row){await client.query("commit");return {scheduled:0};}
    const idempotencyKey=metaSyncIdempotencyKey(row.id,row.scheduled_for);
    const inserted=await client.query(
      `insert into public.meta_sync_runs(
         organization_id,project_id,connection_id,schedule_id,idempotency_key,
         status,scheduled_for
       ) values($1,$2,$3,$4,$5,'queued',$6)
       on conflict(connection_id,idempotency_key) do nothing
       returning id`,
      [row.organization_id,row.project_id,row.connection_id,row.id,
       idempotencyKey,row.scheduled_for],
    );
    await client.query(
      `update public.meta_sync_schedules
          set last_run_at=now(),
              next_run_at=greatest(now(),$2::timestamptz)
                +($3::text||' minutes')::interval,
              updated_at=now()
        where id=$1`,
      [row.id,row.scheduled_for,row.interval_minutes],
    );
    await client.query("commit");
    return {scheduled:inserted.rowCount??0};
  }catch(error){await client.query("rollback");throw error}
  finally{client.release()}
}
