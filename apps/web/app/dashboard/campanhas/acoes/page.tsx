import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {requestCampaignAction,decideCampaignAction,simulateCampaignAction} from "./actions";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {decideManagerAction,executeApprovedManagerAction} from "../../gerenciador-anuncios/actions";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{status?:string;campaign?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const db=getDatabase();const campaigns=(await db.pool.query<{id:string;name:string}>(`
  select id,name from public.meta_campaigns where project_id=$1 order by name`,[project.id])).rows;
 const requests=(await db.pool.query<{id:string;campaign_name:string;action_type:string;reason:string;
  status:string;snapshot_sha256:string;created_at:string;snapshot:{action?:{dailyBudget?:number;currency?:string}};
  simulation_status:string|null;discrepancies:string[]|null}>(`
  select r.id,c.name campaign_name,r.action_type,r.reason,r.status::text,r.snapshot_sha256,
   r.created_at::text,r.snapshot,s.status::text simulation_status,s.discrepancies
   from public.campaign_action_requests r join public.meta_campaigns c
   on c.id=r.meta_campaign_id left join public.campaign_action_simulations s
   on s.campaign_action_request_id=r.id where r.project_id=$1
   order by r.created_at desc limit 50`,[project.id])).rows;
 const managerRequests=(await db.pool.query<{id:string;entity_type:string;action_type:string;reason:string;status:string;execution_status:string;
  before_state:{name?:string;status?:string;currency?:string};desired_state:{status?:string;name?:string;dailyBudgetMinor?:number;currency?:string};created_at:string}>(`select id,entity_type,
  action_type,reason,status::text,execution_status,before_state,desired_state,created_at::text from public.meta_manager_action_requests
  where project_id=$1 order by created_at desc limit 50`,[project.id])).rows;
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/campanhas/acoes" footerLabel="Aprovação humana"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/campanhas/acoes" statusLabel="Aprovação humana"/>
 <div className="dashboard-main">{params.status?<div className={["requested","approved","rejected","simulated","execution-succeeded"].includes(params.status)?"notice notice-success":"notice notice-error"}>
  {["requested","approved","rejected","simulated","execution-succeeded"].includes(params.status)?"Ação registrada com auditoria.":"Não foi possível concluir a ação."}</div>:null}
 <header className="dashboard-titlebar"><div><p className="eyebrow">Controle humano</p><h1>Aprovação de ações</h1>
 <p className="dashboard-context">Prepare e aprove uma intenção. Nenhuma alteração é enviada à Meta nesta etapa.</p></div></header>
 <section className="analytics-grid"><article className="dashboard-card"><h2>Nova solicitação</h2>
 <form action={requestCampaignAction}><label>Campanha<select name="campaign_id" required
  defaultValue={campaigns.some(item=>item.id===params.campaign)?params.campaign:campaigns[0]?.id}>
  {campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Ação<select name="action_type"><option value="pause">Preparar pausa</option><option value="set_daily_budget">Preparar orçamento diário</option></select></label>
 <label>Novo orçamento diário<input name="daily_budget" type="number" min="0.01" step="0.01"/></label>
 <label>Motivo<textarea name="reason" minLength={5} required/></label><button type="submit">Criar prévia imutável</button></form></article>
 <article className="dashboard-card"><h2>Histórico</h2>{requests.length?<div className="members-list">{requests.map(r=><div className="member-row" key={r.id}>
 <p><strong>{r.campaign_name}</strong><small>{r.action_type==="pause"?"Pausa":`Orçamento ${r.snapshot.action?.currency??""} ${r.snapshot.action?.dailyBudget??""}`}</small>
 <small>{r.reason}</small><small>Hash {r.snapshot_sha256.slice(0,12)}…</small></p><span className="member-role">{r.status}</span>
 {r.status==="pending_approval"&&["owner","administrator"].includes(project.role)?<div><form action={decideCampaignAction}><input type="hidden" name="request_id" value={r.id}/><input type="hidden" name="decision" value="approved"/><button>Aprovar</button></form>
 <form action={decideCampaignAction}><input type="hidden" name="request_id" value={r.id}/><input type="hidden" name="decision" value="rejected"/><button>Rejeitar</button></form></div>:null}
 {r.status==="approved"&&["owner","administrator"].includes(project.role)?<form action={simulateCampaignAction}>
  <input type="hidden" name="request_id" value={r.id}/><button>Simular e reconciliar</button></form>:null}
 {r.simulation_status?<small>{r.simulation_status==="validated"?"Validada sem divergências":"Reconciliação necessária"}
  {r.discrepancies?.length?` · ${r.discrepancies.join(", ")}`:""}</small>:null}</div>)}</div>:<div className="compact-empty">Nenhuma solicitação criada.</div>}</article></section>
 <section className="dashboard-card"><h2>Solicitações do gerenciador</h2><p>Campanhas, conjuntos e anúncios. Aprovar não executa a mudança externa; libera a próxima etapa controlada.</p>
 {managerRequests.length?<div className="members-list">{managerRequests.map(request=><div className="member-row" key={request.id}><p>
  <strong>{request.before_state.name??request.entity_type}</strong><small>{request.entity_type} · {request.before_state.status??"—"} → {request.desired_state.status??"edição solicitada"}</small>
  {request.action_type==="update_name"?<small>Novo nome: {request.desired_state.name??"—"}</small>:null}
  {request.action_type==="update_budget"?<small>Novo orçamento diário: {request.desired_state.currency??request.before_state.currency??""} {((request.desired_state.dailyBudgetMinor??0)/100).toFixed(2)}</small>:null}
  <small>{request.reason}</small></p><span className="member-role">{request.status}</span>
  {request.status==="pending_approval"&&["owner","administrator"].includes(project.role)?<div><form action={decideManagerAction}>
   <input type="hidden" name="request_id" value={request.id}/><input type="hidden" name="decision" value="approved"/><button>Aprovar</button></form>
   <form action={decideManagerAction}><input type="hidden" name="request_id" value={request.id}/><input type="hidden" name="decision" value="rejected"/><button>Rejeitar</button></form></div>:null}
  {request.status==="approved"&&["owner","administrator"].includes(project.role)&&request.execution_status!=="succeeded"?<form action={executeApprovedManagerAction}>
   <input type="hidden" name="request_id" value={request.id}/><button>Executar alteração na Meta</button><small>Esta confirmação altera o objeto real na Meta e depois verifica o resultado.</small></form>:null}
  {request.execution_status!=="not_started"?<small>Execução: {request.execution_status}</small>:null}
 </div>)}</div>:<div className="compact-empty">Nenhuma solicitação do gerenciador.</div>}</section>
 </div></section></main>;
}
