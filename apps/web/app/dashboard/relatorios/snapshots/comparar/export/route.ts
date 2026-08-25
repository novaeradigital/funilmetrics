import {randomUUID} from "node:crypto";import {createClient} from "../../../../../../lib/supabase/server";
import {getActiveProject} from "../../../../../../lib/active-project";import {getDatabase} from "../../../../../../lib/database";
type Row={id:string;organization_id:string;scheduled_for:Date;period_days:number;rule_version:string;snapshot:Record<string,unknown>};
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
const number=(row:Row,key:string)=>Number(row.snapshot[key]??0);
export async function GET(request:Request){
 const url=new URL(request.url),baseId=url.searchParams.get("base")??"",currentId=url.searchParams.get("current")??"";
 if(!/^[0-9a-f-]{36}$/i.test(baseId)||!/^[0-9a-f-]{36}$/i.test(currentId)||baseId===currentId)
  return new Response("Comparação inválida",{status:400});
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)return new Response("Não autorizado",{status:401});
 const {project}=await getActiveProject(data.user.id);if(!project)return new Response("Projeto indisponível",{status:403});
 const db=getDatabase(),client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id and membership.organization_id=$2
   where app_user.auth_user_id=$1 limit 1`,[data.user.id,project.organization_id])).rows[0];
  const rows=(await client.query<Row>(`select id,organization_id,scheduled_for,period_days,rule_version,snapshot
   from public.report_snapshots where project_id=$1 and id=any($2::uuid[])`,
   [project.id,[baseId,currentId]])).rows,base=rows.find(row=>row.id===baseId),current=rows.find(row=>row.id===currentId);
  if(!actor||!base||!current||base.period_days!==current.period_days||base.rule_version!==current.rule_version){
   await client.query("rollback");return new Response("Comparação inválida",{status:400})}
  const metrics:Array<[string,string]>=[["receita_bruta","gross_revenue"],["receita_liquida","net_revenue"],
   ["pagamentos_aprovados","approved_payments"],["pagamentos_revertidos","reversed_payments"],
   ["eventos_observados","observed_events"]];
  const table:Array<Array<unknown>>=[["metrica","base","atual","diferenca","variacao_percentual"],
   ...metrics.map(([label,key])=>{const before=number(base,key),after=number(current,key);
    return [label,before,after,after-before,before!==0?(after-before)/Math.abs(before)*100:null]})];
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id) values($1,$2,$3,
   'financial_report_snapshot_comparison_exported','report_snapshot_comparison',$4,
   'Exportação solicitada pelo usuário',$5::jsonb,$6)`,[base.organization_id,project.id,actor.id,
    `${base.id}:${current.id}`,JSON.stringify({format:"csv",baseId:base.id,currentId:current.id,
     periodDays:base.period_days,ruleVersion:base.rule_version}),randomUUID()]);
  await client.query("commit");
  const metadata=[["snapshot_base",base.id],["snapshot_atual",current.id],
   ["agendado_base",base.scheduled_for.toISOString()],["agendado_atual",current.scheduled_for.toISOString()],
   ["janela_dias",base.period_days],["regra",base.rule_version],[],...table];
  return new Response(`\uFEFF${metadata.map(row=>row.map(cell).join(";")).join("\r\n")}`,{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":`attachment; filename="funil-metrics-comparacao-${base.id}-${current.id}.csv"`,
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{await client.query("rollback");console.error("financial_snapshot_comparison_export_failed");
  return new Response("Não foi possível exportar",{status:500})}finally{client.release()}
}
