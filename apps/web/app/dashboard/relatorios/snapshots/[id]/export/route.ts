import {randomUUID} from "node:crypto";import {createClient} from "../../../../../../lib/supabase/server";
import {getActiveProject} from "../../../../../../lib/active-project";import {getDatabase} from "../../../../../../lib/database";
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;
type Snapshot={id:string;organization_id:string;scheduled_for:Date;period_days:number;
 rule_version:string;snapshot:Record<string,unknown>;created_at:Date};
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response("Não encontrado",{status:404});
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)return new Response("Não autorizado",{status:401});
 const {project}=await getActiveProject(data.user.id);if(!project)return new Response("Projeto indisponível",{status:403});
 const db=getDatabase(),client=await db.pool.connect();try{await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id
    and membership.organization_id=$2 where app_user.auth_user_id=$1 limit 1`,
   [data.user.id,project.organization_id])).rows[0];
  const item=(await client.query<Snapshot>(`select id,organization_id,scheduled_for,period_days,
   rule_version,snapshot,created_at from public.report_snapshots where id=$1 and project_id=$2`,
   [id,project.id])).rows[0];if(!actor||!item){await client.query("rollback");return new Response("Não encontrado",{status:404})}
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id) values($1,$2,$3,
   'financial_report_snapshot_exported','report_snapshot',$4,'Exportação solicitada pelo usuário',
   $5::jsonb,$6)`,[item.organization_id,project.id,actor.id,item.id,
    JSON.stringify({format:"csv",periodDays:item.period_days,ruleVersion:item.rule_version}),randomUUID()]);
  await client.query("commit");
  const rows=[["snapshot_id","agendado_para","criado_em","janela_dias","regra",
   "eventos_observados","pagamentos_aprovados","pagamentos_revertidos","receita_bruta","receita_liquida"],
   [item.id,item.scheduled_for.toISOString(),item.created_at.toISOString(),item.period_days,item.rule_version,
    item.snapshot.observed_events,item.snapshot.approved_payments,item.snapshot.reversed_payments,
    item.snapshot.gross_revenue,item.snapshot.net_revenue]];
  return new Response(`\uFEFF${rows.map(row=>row.map(cell).join(";")).join("\r\n")}`,{headers:{
   "Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="funil-metrics-snapshot-${item.id}.csv"`,
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{await client.query("rollback");console.error("financial_report_snapshot_export_failed");
  return new Response("Não foi possível exportar",{status:500})}finally{client.release()}
}
