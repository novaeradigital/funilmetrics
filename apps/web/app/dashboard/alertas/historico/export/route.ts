import {randomUUID} from "node:crypto";import {createClient} from "../../../../../lib/supabase/server";
import {getActiveProject} from "../../../../../lib/active-project";import {getDatabase} from "../../../../../lib/database";
type Row={id:string;title:string;issue_type:string;severity:string;status:string;occurrences:number;
 first_detected_at:Date;last_detected_at:Date;resolved_at:Date|null;rule_version:string;
 connection_name:string|null;evidence:Record<string,unknown>};
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
export async function GET(request:Request){
 const url=new URL(request.url),status=["open","resolved"].includes(url.searchParams.get("status")??"")?url.searchParams.get("status")!:"",
  severity=["critical","warning","info"].includes(url.searchParams.get("severity")??"")?url.searchParams.get("severity")!:"",
  search=(url.searchParams.get("q")??"").trim().slice(0,100);
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)return new Response("Não autorizado",{status:401});
 const {project}=await getActiveProject(data.user.id);if(!project)return new Response("Projeto indisponível",{status:403});
 const db=getDatabase(),client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id and membership.organization_id=$2
   where app_user.auth_user_id=$1 limit 1`,[data.user.id,project.organization_id])).rows[0];
  if(!actor){await client.query("rollback");return new Response("Sem permissão",{status:403})}
  const rows=(await client.query<Row>(`select issue.id,issue.title,issue.issue_type,issue.severity,
   issue.status,issue.occurrences,issue.first_detected_at,issue.last_detected_at,issue.resolved_at,
   issue.rule_version,issue.evidence,connection.name connection_name
   from public.data_quality_issues issue left join public.connections connection on connection.id=issue.connection_id
   where issue.project_id=$1 and ($2='' or issue.status=$2) and ($3='' or issue.severity=$3)
    and ($4='' or issue.title ilike '%'||$4||'%' or issue.issue_type ilike '%'||$4||'%')
   order by issue.last_detected_at desc limit 10000`,[project.id,status,severity,search])).rows;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id) values($1,$2,$3,
   'data_quality_issue_history_exported','report','data_quality_issue_history',
   'Exportação solicitada pelo usuário',$4::jsonb,$5)`,[project.organization_id,project.id,actor.id,
    JSON.stringify({format:"csv",rows:rows.length,filters:{status:status||null,severity:severity||null,search:search||null},
     limit:10000}),randomUUID()]);
  await client.query("commit");
  const table:Array<Array<unknown>>=[["id","titulo","tipo","severidade","estado","avaliacoes",
   "primeira_deteccao","ultima_deteccao","resolvido_em","conexao","regra","evidencia"],
   ...rows.map(row=>[row.id,row.title,row.issue_type,row.severity,row.status,row.occurrences,
    row.first_detected_at.toISOString(),row.last_detected_at.toISOString(),row.resolved_at?.toISOString(),
    row.connection_name,row.rule_version,JSON.stringify(row.evidence)])];
  return new Response(`\uFEFF${table.map(row=>row.map(cell).join(";")).join("\r\n")}`,{headers:{
   "Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="funil-metrics-alertas.csv"',
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{await client.query("rollback");console.error("data_quality_issue_history_export_failed");
  return new Response("Não foi possível exportar",{status:500})}finally{client.release()}
}
