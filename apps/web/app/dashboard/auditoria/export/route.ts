import {randomUUID} from "node:crypto";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {sanitizeAuditValue} from "../../../../lib/audit-sanitizer";

type Row={
 id:string;project_id:string|null;action:string;target_type:string;target_id:string|null;reason:string|null;
 before:unknown;after:unknown;metadata:unknown;request_id:string|null;occurred_at:Date;
 actor_name:string|null;actor_email:string|null;
};
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
const serialized=(value:unknown)=>value==null?"":JSON.stringify(sanitizeAuditValue(value));

export async function GET(request:Request){
 const url=new URL(request.url),action=(url.searchParams.get("action")??"").trim().slice(0,100),
  target=(url.searchParams.get("target")??"").trim().slice(0,100),
  search=(url.searchParams.get("q")??"").trim().slice(0,100),
  from=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from")??"")?url.searchParams.get("from")!:"",
  to=/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to")??"")?url.searchParams.get("to")!:"";
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)return new Response("Não autorizado",{status:401});
 const {project}=await getActiveProject(data.user.id);
 if(!project)return new Response("Projeto indisponível",{status:403});
 if(!["owner","administrator"].includes(project.role))return new Response("Sem permissão",{status:403});
 const db=getDatabase(),client=await db.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id and membership.organization_id=$2
   where app_user.auth_user_id=$1 limit 1`,[data.user.id,project.organization_id])).rows[0];
  if(!actor){await client.query("rollback");return new Response("Sem permissão",{status:403})}
  const rows=(await client.query<Row>(`select audit.id,audit.project_id,audit.action,audit.target_type,audit.target_id,
   audit.reason,audit.before,audit.after,audit.metadata,audit.request_id,audit.occurred_at,
   app_user.display_name actor_name,app_user.email actor_email
   from public.audit_logs audit left join public.users app_user on app_user.id=audit.actor_user_id
   where (audit.project_id=$1 or (audit.project_id is null and audit.organization_id=
    (select organization_id from public.projects where id=$1)))
    and ($2='' or audit.action=$2) and ($3='' or audit.target_type=$3)
    and ($4='' or audit.action ilike '%'||$4||'%' or coalesce(audit.target_id,'') ilike '%'||$4||'%'
     or coalesce(audit.request_id,'') ilike '%'||$4||'%'
     or coalesce(app_user.display_name,app_user.email,'') ilike '%'||$4||'%')
    and ($5='' or audit.occurred_at>=$5::date) and ($6='' or audit.occurred_at<$6::date+1)
   order by audit.occurred_at desc limit 10000`,[project.id,action,target,search,from,to])).rows;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id) values($1,$2,$3,
   'audit_log_exported','report','project_audit_log','Exportação solicitada pelo usuário',$4::jsonb,$5)`,
   [project.organization_id,project.id,actor.id,JSON.stringify({format:"csv",rows:rows.length,
    filters:{action:action||null,target:target||null,search:search||null,from:from||null,to:to||null},limit:10000,
    redaction:"recursive_sensitive_key_v1"}),randomUUID()]);
  await client.query("commit");
  const table:Array<Array<unknown>>=[["id","quando","escopo","acao","tipo_alvo","id_alvo","ator","email_ator",
   "motivo","request_id","antes_sanitizado","depois_sanitizado","metadados_sanitizados"],
   ...rows.map(row=>[row.id,row.occurred_at.toISOString(),row.project_id?"projeto":"organizacao",
    row.action,row.target_type,row.target_id,
    row.actor_name??(row.actor_email?"Usuário":"Sistema"),row.actor_email,row.reason,row.request_id,
    serialized(row.before),serialized(row.after),serialized(row.metadata)])];
  return new Response(`\uFEFF${table.map(row=>row.map(cell).join(";")).join("\r\n")}`,{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":'attachment; filename="funil-metrics-auditoria.csv"',
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{
  await client.query("rollback");console.error("audit_log_export_failed");
  return new Response("Não foi possível exportar",{status:500});
 }finally{client.release()}
}
