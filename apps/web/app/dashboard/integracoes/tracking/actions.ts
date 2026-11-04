"use server";
import {redirect} from "next/navigation";import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
const allowedRoles=new Set(["owner","administrator"]);
const triggerTypes=new Set(["attribute","selector","id","url"]);
function trackingMetaFields(formData:FormData){
 const businessId=String(formData.get("business_project_id")??"");
 const triggerType=String(formData.get("ic_trigger_type")??"attribute");
 const triggerValue=String(formData.get("ic_trigger_value")??"").trim().slice(0,300);
 return {businessId:/^[0-9a-f-]{36}$/i.test(businessId)?businessId:null,
  triggerType:triggerTypes.has(triggerType)?triggerType:"attribute",
  triggerValue:triggerValue||null,productPage:formData.get("product_page")==="on"};
}
export async function createTrackingSource(formData:FormData){
 const meta=trackingMetaFields(formData);
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
   project_id,name,allowed_origins,created_by_user_id,business_project_id,
   ic_trigger_type,ic_trigger_value,product_page) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
   [project.organization_id,project.id,name,origins,actor.id,meta.businessId,
   meta.triggerType,meta.triggerValue,meta.productPage])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'tracking_source_created',
   'tracking_source',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,row.id,
   JSON.stringify({name,allowedOrigins:origins,...meta})]);await client.query("commit");
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

export async function updateTrackingSource(formData:FormData){
 const id=String(formData.get("source_id")??"");const meta=trackingMetaFields(formData);
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/integracoes/tracking?status=invalid");
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project||!allowedRoles.has(project.role))
  redirect("/dashboard/integracoes/tracking?status=forbidden");
 const db=getDatabase(),actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0]!;
 const row=(await db.pool.query<{id:string}>(`update public.tracking_sources set business_project_id=$1,
  ic_trigger_type=$2,ic_trigger_value=$3,product_page=$4,updated_at=now()
  where id=$5 and project_id=$6 returning id`,[meta.businessId,meta.triggerType,meta.triggerValue,
  meta.productPage,id,project.id])).rows[0];
 if(!row)redirect("/dashboard/integracoes/tracking?status=not-found");
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'tracking_source_updated',
  'tracking_source',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,id,JSON.stringify(meta)]);
 revalidatePath("/dashboard/integracoes/tracking");redirect("/dashboard/integracoes/tracking?status=updated");
}
