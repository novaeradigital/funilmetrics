"use server";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";

const safePeriod=new Set(["24h","7d","30d","all"]);
const safeStatus=new Set(["all","normalized","duplicate","backlog","failed","quarantined","partial","unknown"]);
function returnUrl(formData:FormData,notice:string){
 const period=String(formData.get("return_period")??"7d");
 const status=String(formData.get("return_status")??"all");
 const connection=String(formData.get("return_connection")??"");
 const query=new URLSearchParams({period:safePeriod.has(period)?period:"7d",
  status:safeStatus.has(status)?status:"all",notice});
 if(/^[0-9a-f-]{36}$/i.test(connection))query.set("connection",connection);
 return `/dashboard/qualidade?${query}`;
}

export async function retryRawEvent(formData:FormData){
 const eventId=String(formData.get("event_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(eventId))redirect(returnUrl(formData,"retry-invalid"));
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 if(!["owner","administrator"].includes(project.role))
  redirect(returnUrl(formData,"retry-forbidden"));
 const database=getDatabase(),client=await database.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id and membership.organization_id=$2
   where app_user.auth_user_id=$1 limit 1`,[data.user.id,project.organization_id])).rows[0];
  if(!actor)throw new Error("actor_missing");
  const event=(await client.query<{error_code:string|null;processing_attempts:number}>(`update public.raw_events
   set processing_status='queued' where id=$1 and project_id=$2 and source='lastlink'
   and processing_status='failed_retryable' returning error_code,processing_attempts`,
   [eventId,project.id])).rows[0];
  if(!event)throw new Error("not_retryable");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,before,after,request_id) values($1,$2,$3,
   'raw_event_retry_requested','raw_event',$4,'Retentativa manual de falha recuperável',
   $5::jsonb,$6::jsonb,$7)`,[project.organization_id,project.id,actor.id,eventId,
    JSON.stringify({processing_status:"failed_retryable",error_code:event.error_code,
     processing_attempts:event.processing_attempts}),
    JSON.stringify({processing_status:"queued"}),randomUUID()]);
  await client.query("commit");
 }catch{
  await client.query("rollback");
  redirect(returnUrl(formData,"retry-unavailable"));
 }finally{
  client.release();
 }
 revalidatePath("/dashboard/qualidade");
 redirect(returnUrl(formData,"retry-queued"));
}
