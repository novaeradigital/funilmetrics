"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {getDatabase} from "../../../lib/database";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";

export async function saveReportSchedule(formData:FormData){
  const frequency=String(formData.get("frequency")??"");
  const periodDays=Number(formData.get("period_days"));
  const enabled=formData.get("enabled")==="on";
  if(!["daily","weekly"].includes(frequency)||![7,30,90].includes(periodDays))
    redirect("/dashboard/relatorios?status=schedule-invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const {project}=await getActiveProject(data.user.id);
  if(!project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const scope=await database.pool.query<{user_id:string;organization_id:string}>(
    `select app_user.id user_id,membership.organization_id
      from public.users app_user join public.memberships membership
        on membership.user_id=app_user.id
      where app_user.auth_user_id=$1 and membership.organization_id=$2
        and membership.role in('owner','administrator') limit 1`,
    [data.user.id,project.organization_id]);
  const actor=scope.rows[0];
  if(!actor)redirect("/dashboard/relatorios?status=schedule-forbidden");
  await database.pool.query(`insert into public.report_schedules(
    organization_id,project_id,frequency,period_days,enabled,next_run_at,created_by_user_id)
    values($1,$2,$3::public.report_frequency,$4,$5,now(),$6)
    on conflict(project_id) do update set frequency=excluded.frequency,
      period_days=excluded.period_days,enabled=excluded.enabled,
      next_run_at=case when excluded.enabled then now() else report_schedules.next_run_at end,
      updated_at=now()`,
  [actor.organization_id,project.id,frequency,periodDays,enabled,actor.user_id]);
  await database.pool.query(`insert into public.audit_logs(organization_id,project_id,
    actor_user_id,action,target_type,target_id,after)
    values($1,$2,$3,'financial_report_schedule_updated','report_schedule',$2,$4::jsonb)`,
  [actor.organization_id,project.id,actor.user_id,
    JSON.stringify({frequency,periodDays,enabled,channel:"in_app"})]);
  revalidatePath("/dashboard/relatorios");
  redirect("/dashboard/relatorios?status=schedule-saved");
}
export async function generateReportSnapshotNow(){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const database=getDatabase(),client=await database.pool.connect();let snapshotId="";
 try{await client.query("begin");
  const actor=(await client.query<{user_id:string;organization_id:string}>(`select app_user.id user_id,
   membership.organization_id from public.users app_user join public.memberships membership
    on membership.user_id=app_user.id where app_user.auth_user_id=$1
    and membership.organization_id=$2 and membership.role in('owner','administrator') limit 1`,
   [data.user.id,project.organization_id])).rows[0];if(!actor)throw new Error("forbidden");
  const schedule=(await client.query<{id:string;period_days:number}>(`select id,period_days
   from public.report_schedules where project_id=$1`,[project.id])).rows[0];
  if(!schedule)throw new Error("schedule_missing");
  const result=(await client.query<{id:string}>(`with cutoff as (
    select date_trunc('minute',now()) scheduled_for
   ),metrics as (
    select coalesce(sum(financial_effect) filter(where financial_effect>0),0)::text gross_revenue,
     coalesce(sum(financial_effect),0)::text net_revenue,
     count(distinct payment_id) filter(where financial_effect>0)::int approved_payments,
     count(distinct payment_id) filter(where financial_effect<0)::int reversed_payments,
     count(*)::int observed_events
    from public.normalized_payment_events where project_id=$1 and data_scope='production'
     and occurred_at>=now()-($2*interval '1 day')
   ),inserted as (
    insert into public.report_snapshots(organization_id,project_id,schedule_id,
     scheduled_for,period_days,rule_version,snapshot)
    select $3,$1,$4,cutoff.scheduled_for,$2,'financial_v1',to_jsonb(metrics)
    from cutoff,metrics on conflict(schedule_id,scheduled_for) do nothing returning id
   )
   select id from inserted union all select snapshot.id from public.report_snapshots snapshot,cutoff
    where snapshot.schedule_id=$4 and snapshot.scheduled_for=cutoff.scheduled_for limit 1`,
   [project.id,schedule.period_days,actor.organization_id,schedule.id])).rows[0];
  if(!result)throw new Error("snapshot_failed");snapshotId=result.id;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'financial_report_snapshot_requested',
   'report_snapshot',$4,$5::jsonb)`,[actor.organization_id,project.id,actor.user_id,snapshotId,
    JSON.stringify({periodDays:schedule.period_days,ruleVersion:"financial_v1",mode:"manual"})]);
  await client.query("commit");
 }catch(error){await client.query("rollback");const code=error instanceof Error?error.message:"failed";
  redirect(`/dashboard/relatorios?status=${code==="schedule_missing"?"schedule-required":code==="forbidden"?"schedule-forbidden":"snapshot-failed"}`)
 }finally{client.release()}
 revalidatePath("/dashboard/relatorios");redirect(`/dashboard/relatorios/snapshots/${snapshotId}`);
}
