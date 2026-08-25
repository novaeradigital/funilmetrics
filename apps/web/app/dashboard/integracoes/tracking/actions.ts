"use server";
import {redirect} from "next/navigation";import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
const allowedRoles=new Set(["owner","administrator"]);
export async function createTrackingSource(formData:FormData){
 const name=String(formData.get("name")??"").trim().slice(0,120);
 const origins=String(formData.get("allowed_origins")??"").split(/\s+/).filter(Boolean);
 if(!name||!origins.length||origins.some(value=>{try{const u=new URL(value);return u.origin!==value||!["http:","https:"].includes(u.protocol)}catch{return true}}))
  redirect("/dashboard/integracoes/tracking?status=invalid");
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!allowedRoles.has(project.role))
  redirect("/dashboard/integracoes/tracking?status=forbidden");
 const db=getDatabase();const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
 const client=await db.pool.connect();try{await client.query("begin");
  const row=(await client.query<{id:string}>(`insert into public.tracking_sources(organization_id,
   project_id,name,allowed_origins,created_by_user_id) values($1,$2,$3,$4,$5) returning id`,
   [project.organization_id,project.id,name,origins,actor.id])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'tracking_source_created',
   'tracking_source',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,row.id,
   JSON.stringify({name,allowedOrigins:origins})]);await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/integracoes/tracking?status=failed")}finally{client.release()}
 revalidatePath("/dashboard/integracoes/tracking");redirect("/dashboard/integracoes/tracking?status=created");
}
export async function toggleTrackingSource(formData:FormData){
 const id=String(formData.get("source_id")??""),active=String(formData.get("active"))==="true";
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/integracoes/tracking?status=invalid");
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!allowedRoles.has(project.role))
  redirect("/dashboard/integracoes/tracking?status=forbidden");
 const db=getDatabase(),actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
 const row=(await db.pool.query<{id:string}>(`update public.tracking_sources set active=$1,updated_at=now()
  where id=$2 and project_id=$3 returning id`,[active,id,project.id])).rows[0];
 if(!row)redirect("/dashboard/integracoes/tracking?status=not-found");
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'tracking_source_status_changed',
  'tracking_source',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,id,JSON.stringify({active})]);
 revalidatePath("/dashboard/integracoes/tracking");redirect("/dashboard/integracoes/tracking?status=updated");
}
