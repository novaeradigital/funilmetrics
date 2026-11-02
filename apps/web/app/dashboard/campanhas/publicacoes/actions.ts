"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";

export async function retryUpload(formData:FormData){
 const uploadId=String(formData.get("upload_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(uploadId))
  redirect("/dashboard/campanhas/publicacoes?status=invalid");
 const supabase=await createClient();const {data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project||!["owner","administrator","editor"].includes(project.role))
  redirect("/dashboard/campanhas/publicacoes?status=forbidden");
 const db=getDatabase();const client=await db.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0];
  const upload=(await client.query<{id:string}>(`update public.campaign_uploads
    set status='queued',finished_at=null,error_code=null,error_message=null,updated_at=now()
    where id=$1 and project_id=$2 and status in ('partial','failed') returning id`,
   [uploadId,project.id])).rows[0];
  if(!upload)throw new Error("not_retryable");
  await client.query(`update public.campaign_upload_items
    set status='pending',error_code=null,error_message=null,updated_at=now()
    where upload_id=$1 and status in ('failed','skipped')`,[uploadId]);
  if(actor)await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'campaign_upload_retried',
   'campaign_upload',$4,'{}'::jsonb)`,[project.organization_id,project.id,actor.id,uploadId]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/campanhas/publicacoes?status=failed");}
 finally{client.release();}
 revalidatePath("/dashboard/campanhas/publicacoes");
 redirect("/dashboard/campanhas/publicacoes?status=retried");
}
