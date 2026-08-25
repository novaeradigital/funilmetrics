import type pg from "pg";

export async function scheduleGoogleDriveSync(pool:pg.Pool){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const due=await client.query<{
      id:string;organization_id:string;project_id:string;drive_folder_id:string;
      interval_minutes:number;requested_by_user_id:string;scheduled_for:Date;
    }>(
      `select schedule.id,schedule.organization_id,schedule.project_id,
       schedule.drive_folder_id,schedule.interval_minutes,
       membership.user_id requested_by_user_id,schedule.next_run_at scheduled_for
       from public.drive_sync_schedules schedule
       join lateral (
         select membership.user_id from public.memberships membership
         where membership.organization_id=schedule.organization_id
           and membership.role in ('owner','administrator')
         order by case membership.role when 'owner' then 0 else 1 end,membership.created_at
         limit 1
       ) membership on true
       where schedule.enabled and schedule.next_run_at<=now()
       order by schedule.next_run_at limit 1 for update of schedule skip locked`);
    const row=due.rows[0];
    if(!row){await client.query("commit");return {scheduled:0};}
    const idempotency=`automatic-sync:${row.id}:${row.scheduled_for.toISOString()}`;
    await client.query(
      `insert into public.drive_import_jobs(organization_id,project_id,drive_folder_id,
       requested_by_user_id,idempotency_key,status)
       values($1,$2,$3,$4,$5,'pending')
       on conflict (drive_folder_id,idempotency_key) do nothing`,
      [row.organization_id,row.project_id,row.drive_folder_id,row.requested_by_user_id,idempotency]);
    await client.query(
      `update public.drive_sync_schedules set last_run_at=now(),
       next_run_at=now()+($2::text||' minutes')::interval,updated_at=now() where id=$1`,
      [row.id,row.interval_minutes]);
    await client.query("commit");
    return {scheduled:1};
  }catch(error){await client.query("rollback");throw error}
  finally{client.release()}
}
