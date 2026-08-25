import Link from "next/link";import {redirect} from "next/navigation";import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";import {getDatabase} from "../../../lib/database";
import {createFunnel,addFunnelStep,linkFunnelSource,unlinkFunnelSource,updateFunnelStatus} from "./actions";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
export const dynamic="force-dynamic";
type Funnel={id:string;name:string;operation_type:string;status:string;starts_at:string|null;ends_at:string|null};
type Step={id:string;funnel_id:string;position:number;name:string;event_key:string};
type Source={id:string;name:string};type Linked={funnel_id:string;source_id:string;source_name:string};
type Observed={funnel_id:string;event_key:string;observed:number};
const eventOptions=[["page_view","Visualização de página"],["video_play","Reprodução de vídeo"],
 ["video_progress_50","Vídeo 50%"],["video_complete","Vídeo concluído"],["cta_click","Clique em CTA"],
 ["form_submit","Formulário enviado"],["checkout_abandoned","Checkout abandonado"],
 ["payment_pending","Pagamento pendente"],["payment_approved","Pagamento aprovado"],
 ["payment_refunded","Reembolso"],["payment_chargeback","Chargeback"]];
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");const db=getDatabase();
 const funnels=(await db.pool.query<Funnel>(`select id,name,operation_type::text,status::text,
  starts_at::text,ends_at::text from public.funnels where project_id=$1 order by created_at desc`,[project.id])).rows;
 const steps=(await db.pool.query<Step>(`select id,funnel_id,position,name,event_key from public.funnel_steps
  where project_id=$1 order by funnel_id,position`,[project.id])).rows;
 const sources=(await db.pool.query<Source>(`select id,name from public.tracking_sources
  where project_id=$1 and active order by name`,[project.id])).rows;
 const linked=(await db.pool.query<Linked>(`select link.funnel_id,source.id source_id,source.name source_name
  from public.funnel_tracking_sources link join public.tracking_sources source
  on source.id=link.tracking_source_id where link.project_id=$1 and link.active order by source.name`,[project.id])).rows;
 const observed=(await db.pool.query<Observed>(`select metric.funnel_id,metric.event_key,
  sum(metric.observed)::int observed from (
   select link.funnel_id,event.event_type event_key,
    count(distinct coalesce(event.visitor_id,event.session_id,event.external_event_id)) observed
   from public.funnel_tracking_sources link join public.funnels funnel on funnel.id=link.funnel_id and link.active
   join public.tracking_events event on event.tracking_source_id=link.tracking_source_id
    and not event.is_bot and (funnel.starts_at is null or event.occurred_at>=funnel.starts_at)
    and (funnel.ends_at is null or event.occurred_at<=funnel.ends_at)
   where link.project_id=$1 group by link.funnel_id,event.event_type
   union all
   select link.funnel_id,payment.type::text event_key,count(distinct conversion.order_id) observed
   from public.funnel_tracking_sources link join public.funnels funnel on funnel.id=link.funnel_id and link.active
   join public.tracking_conversions conversion on conversion.tracking_source_id=link.tracking_source_id
   join public.normalized_payment_events payment on payment.order_id=conversion.order_id
    and payment.data_scope='production'
    and (funnel.starts_at is null or payment.occurred_at>=funnel.starts_at)
    and (funnel.ends_at is null or payment.occurred_at<=funnel.ends_at)
   where link.project_id=$1 group by link.funnel_id,payment.type
  ) metric group by metric.funnel_id,metric.event_key`,[project.id])).rows;
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/funis" footerLabel="Funis versionados"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/funis" statusLabel="Funis versionados"/><div className="dashboard-main">
 {params.status?<div className={["created","step-created","source-linked","source-unlinked","status-updated"].includes(params.status)?"notice notice-success":"notice notice-error"}>
 {["created","step-created","source-linked","source-unlinked","status-updated"].includes(params.status)?"Definição salva e auditada.":"Não foi possível salvar a definição."}</div>:null}
 <header className="dashboard-titlebar"><div><p className="eyebrow">Estrutura operacional</p><h1>Definições de funil</h1>
 <p className="dashboard-context">Funil, campanha e pessoa permanecem entidades diferentes. O cadastro não atribui pessoas automaticamente.</p>
 <Link className="button-link" href="/dashboard/funis/export">Exportar CSV auditado</Link></div></header>
 <section className="analytics-grid"><article className="dashboard-card"><h2>Novo funil</h2><form action={createFunnel}>
 <label>Nome<input name="name" required/></label><label>Tipo<select name="operation_type"><option value="perpetual">Perpétuo</option><option value="launch">Lançamento</option><option value="hybrid">Híbrido</option></select></label>
 <label>Início<input name="starts_at" type="datetime-local"/></label><label>Fim<input name="ends_at" type="datetime-local"/></label>
 <small>Lançamentos exigem início e fim. Perpétuos podem operar sem janela.</small><button>Criar rascunho</button></form></article>
 <article className="dashboard-card"><h2>Funis cadastrados</h2>{funnels.length?<div className="members-list">{funnels.map(f=><div className="member-row" key={f.id}>
 <p><strong>{f.name}</strong><small>{f.operation_type} · {f.status}</small>
 {steps.filter(s=>s.funnel_id===f.id).map(s=><small key={s.id}>{s.position}. {s.name} · {s.event_key} · {
  observed.find(o=>o.funnel_id===f.id&&o.event_key===s.event_key)?.observed??0} pessoa(s)/pedido(s)</small>)}
 <small>Fontes: {linked.filter(l=>l.funnel_id===f.id).map(l=>l.source_name).join(", ")||"nenhuma"}</small></p>
 <details><summary>Adicionar etapa</summary><form action={addFunnelStep}><input type="hidden" name="funnel_id" value={f.id}/>
 <label>Nome<input name="name" required/></label><label>Evento<select name="event_key">{eventOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 <button>Adicionar etapa</button></form></details>
 <details><summary>Associar fonte</summary><form action={linkFunnelSource}><input type="hidden" name="funnel_id" value={f.id}/>
 <label>Fonte<select name="source_id">{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <button>Associar explicitamente</button></form></details>
 {linked.filter(l=>l.funnel_id===f.id).map(l=><form action={unlinkFunnelSource} key={l.source_id}>
 <input type="hidden" name="funnel_id" value={f.id}/><input type="hidden" name="source_id" value={l.source_id}/>
 <button>Desassociar {l.source_name}</button></form>)}
 <form action={updateFunnelStatus}><input type="hidden" name="funnel_id" value={f.id}/><input type="hidden" name="status" value={f.status==="active"?"archived":"active"}/>
 <button>{f.status==="active"?"Arquivar":"Ativar funil"}</button></form></div>)}</div>:<div className="compact-empty">Nenhum funil definido.</div>}</article></section>
 </div></section></main>;
}
