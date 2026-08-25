"use server";
import {redirect} from "next/navigation";import {revalidatePath} from "next/cache";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
const types=new Set(["perpetual","launch","hybrid"]);
const events=new Set(["page_view","video_play","video_progress_50","video_complete","cta_click",
 "form_submit","checkout_abandoned","payment_pending","payment_approved","payment_refunded","payment_chargeback"]);
async function scope(){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!["owner","administrator","editor"].includes(project.role))
  redirect("/dashboard/funis?status=forbidden");
 const db=getDatabase(),actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
 return {project,db,actor};
}
export async function createFunnel(formData:FormData){
 const name=String(formData.get("name")??"").trim().slice(0,160),type=String(formData.get("operation_type")??"");
 const starts=String(formData.get("starts_at")??"")||null,ends=String(formData.get("ends_at")??"")||null;
 if(!name||!types.has(type)||(type==="launch"&&(!starts||!ends)))redirect("/dashboard/funis?status=invalid");
 const {project,db,actor}=await scope(),client=await db.pool.connect();try{await client.query("begin");
  const row=(await client.query<{id:string}>(`insert into public.funnels(organization_id,project_id,
   name,operation_type,starts_at,ends_at,created_by_user_id) values($1,$2,$3,$4,$5,$6,$7) returning id`,
   [project.organization_id,project.id,name,type,starts,ends,actor.id])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'funnel_created','funnel',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,row.id,JSON.stringify({name,operationType:type,startsAt:starts,endsAt:ends})]);
  await client.query("commit");}catch{await client.query("rollback");redirect("/dashboard/funis?status=failed")}finally{client.release()}
 revalidatePath("/dashboard/funis");redirect("/dashboard/funis?status=created");
}
export async function addFunnelStep(formData:FormData){
 const funnelId=String(formData.get("funnel_id")??""),name=String(formData.get("name")??"").trim().slice(0,120);
 const eventKey=String(formData.get("event_key")??"");
 if(!/^[0-9a-f-]{36}$/i.test(funnelId)||!name||!events.has(eventKey))redirect("/dashboard/funis?status=invalid");
 const {project,db,actor}=await scope(),client=await db.pool.connect();try{await client.query("begin");
  const funnel=(await client.query<{organization_id:string}>(`select organization_id from public.funnels
   where id=$1 and project_id=$2`,[funnelId,project.id])).rows[0];if(!funnel)throw new Error("not_found");
  const position=(await client.query<{position:number}>(`select coalesce(max(position),0)+1 position
   from public.funnel_steps where funnel_id=$1`,[funnelId])).rows[0]!.position;
  const row=(await client.query<{id:string}>(`insert into public.funnel_steps(organization_id,project_id,
   funnel_id,position,name,event_key) values($1,$2,$3,$4,$5,$6) returning id`,
   [project.organization_id,project.id,funnelId,position,name,eventKey])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'funnel_step_created','funnel_step',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,row.id,JSON.stringify({funnelId,position,name,eventKey})]);
  await client.query("commit");}catch{await client.query("rollback");redirect("/dashboard/funis?status=failed")}finally{client.release()}
 revalidatePath("/dashboard/funis");redirect("/dashboard/funis?status=step-created");
}
export async function linkFunnelSource(formData:FormData){
 const funnelId=String(formData.get("funnel_id")??""),sourceId=String(formData.get("source_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(funnelId)||!/^[0-9a-f-]{36}$/i.test(sourceId))
  redirect("/dashboard/funis?status=invalid");
 const {project,db,actor}=await scope();const row=(await db.pool.query<{id:string}>(`
  insert into public.funnel_tracking_sources(organization_id,project_id,funnel_id,
   tracking_source_id,linked_by_user_id)
  select $1,$2,funnel.id,source.id,$5 from public.funnels funnel
  join public.tracking_sources source on source.id=$4 and source.project_id=funnel.project_id
  where funnel.id=$3 and funnel.project_id=$2 on conflict(funnel_id,tracking_source_id)
  do update set active=true,linked_by_user_id=excluded.linked_by_user_id,linked_at=now(),
   unlinked_at=null,unlinked_by_user_id=null returning funnel_id id`,
  [project.organization_id,project.id,funnelId,sourceId,actor.id])).rows[0];
 if(!row)redirect("/dashboard/funis?status=link-failed");
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'funnel_tracking_source_linked',
  'funnel',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,funnelId,JSON.stringify({sourceId})]);
 revalidatePath("/dashboard/funis");redirect("/dashboard/funis?status=source-linked");
}
export async function unlinkFunnelSource(formData:FormData){
 const funnelId=String(formData.get("funnel_id")??""),sourceId=String(formData.get("source_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(funnelId)||!/^[0-9a-f-]{36}$/i.test(sourceId))
  redirect("/dashboard/funis?status=invalid");
 const {project,db,actor}=await scope(),client=await db.pool.connect();try{await client.query("begin");
  const row=(await client.query<{funnel_id:string}>(`update public.funnel_tracking_sources link
   set active=false,unlinked_at=now(),unlinked_by_user_id=$1
   where link.funnel_id=$2 and link.tracking_source_id=$3 and link.project_id=$4 and link.active
   returning link.funnel_id`,[actor.id,funnelId,sourceId,project.id])).rows[0];
  if(!row)throw new Error("not_found");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,before,after) values($1,$2,$3,'funnel_tracking_source_unlinked',
   'funnel',$4,$5::jsonb,$6::jsonb)`,[project.organization_id,project.id,actor.id,funnelId,
    JSON.stringify({sourceId,active:true}),JSON.stringify({sourceId,active:false})]);
  await client.query("commit");}catch{await client.query("rollback");redirect("/dashboard/funis?status=unlink-failed")}
 finally{client.release()}
 revalidatePath("/dashboard/funis");redirect("/dashboard/funis?status=source-unlinked");
}
export async function updateFunnelStatus(formData:FormData){
 const funnelId=String(formData.get("funnel_id")??""),status=String(formData.get("status")??"");
 if(!/^[0-9a-f-]{36}$/i.test(funnelId)||!["active","archived"].includes(status))
  redirect("/dashboard/funis?status=invalid");
 const {project,db,actor}=await scope();
 const row=(await db.pool.query<{id:string}>(`update public.funnels funnel set status=$1,updated_at=now()
  where funnel.id=$2 and funnel.project_id=$3 and
   ($1<>'active' or exists(select 1 from public.funnel_steps step where step.funnel_id=funnel.id))
  returning funnel.id`,[status,funnelId,project.id])).rows[0];
 if(!row)redirect("/dashboard/funis?status=status-failed");
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'funnel_status_changed','funnel',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,funnelId,JSON.stringify({status})]);
 revalidatePath("/dashboard/funis");redirect("/dashboard/funis?status=status-updated");
}
