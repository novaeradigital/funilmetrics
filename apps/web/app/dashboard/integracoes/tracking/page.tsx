import Link from "next/link";import {redirect} from "next/navigation";import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";import {getDatabase} from "../../../../lib/database";
import {createTrackingSource,toggleTrackingSource,updateTrackingSource} from "./actions";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {TrackingTabs} from "../../tracking/tabs";
export const dynamic="force-dynamic";
const triggerLabels:Record<string,string>={attribute:"Atributo no elemento",selector:"Seletor CSS",id:"ID do elemento",url:"URL específica"};
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");const db=getDatabase();
 const businesses=(await db.pool.query<{id:string;name:string}>(`select id::text as id,name
  from public.business_projects where project_id=$1 order by name`,[project.id])).rows;
 const sources=(await db.pool.query<{id:string;name:string;public_key:string;allowed_origins:string[];
  active:boolean;events:number;last_event_at:string|null;business_project_id:string|null;business_name:string|null;
  ic_trigger_type:string;ic_trigger_value:string|null;product_page:boolean}>(`select s.id,s.name,s.public_key::text,s.allowed_origins,s.active,
  count(e.id)::int events,max(e.received_at)::text last_event_at,s.business_project_id::text,
  b.name as business_name,s.ic_trigger_type,s.ic_trigger_value,s.product_page from public.tracking_sources s
  left join public.business_projects b on b.id=s.business_project_id
  left join public.tracking_events e on e.tracking_source_id=s.id where s.project_id=$1
  group by s.id,b.name order by s.created_at desc`,[project.id])).rows;
 const api=process.env.NEXT_PUBLIC_API_URL??"https://api.funilmetrics.site";
 const canEdit=["owner","administrator"].includes(project.role);
 const metaFields=(prefix:string,current?:{business_project_id:string|null;ic_trigger_type:string;ic_trigger_value:string|null;product_page:boolean})=>(<>
  <label>Projeto de negócio<select name="business_project_id" defaultValue={current?.business_project_id??""}>
   <option value="">Sem negócio (não envia para a Meta)</option>
   {businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  <label>Gatilho do InitiateCheckout<select name="ic_trigger_type" defaultValue={current?.ic_trigger_type??"attribute"}>
   <option value="attribute">Atributo data-fm-evento no elemento</option>
   <option value="selector">Seletor CSS</option>
   <option value="id">ID do elemento</option>
   <option value="url">URL específica</option></select></label>
  <label>Valor do gatilho<input name="ic_trigger_value" defaultValue={current?.ic_trigger_value??""}
   placeholder="Ex.: .btn-comprar, btn-comprar ou /checkout"/></label>
  <label><input name="product_page" type="checkbox" defaultChecked={current?.product_page??false}/> Página de produto (dispara ViewContent)</label>
 </>);
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/tracking" footerLabel="Tracking próprio"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/integracoes/tracking" statusLabel="Configuração de tracking"/><div className="dashboard-main">
 <TrackingTabs active="sources"/>
 {params.status?<div className={["created","updated"].includes(params.status)?"notice notice-success":"notice notice-error"}>
  {["created","updated"].includes(params.status)?"Configuração salva e auditada.":"Não foi possível salvar a configuração."}</div>:null}
 <header className="dashboard-titlebar"><div><p className="eyebrow">Rastreamento · Fontes</p><h1>Fontes e script</h1>
 <p className="dashboard-context">Crie uma fonte por site, limite as origens, vincule ao projeto de negócio e instale uma única tag.</p></div></header>
 <p><Link href="/dashboard/tracking">Abrir métricas coletadas →</Link></p>
 <section className="analytics-grid"><article className="dashboard-card"><h2>Nova fonte</h2><form action={createTrackingSource}>
 <label>Nome<input name="name" placeholder="VSL principal" required/></label>
 <label>Origens autorizadas<textarea name="allowed_origins" placeholder={"https://exemplo.com\nhttps://www.exemplo.com"} required/></label>
 <small>Informe uma origem por linha, sem caminho final.</small>
 {metaFields("create")}
 <button>Criar fonte</button></form></article>
 <article className="dashboard-card"><h2>Fontes instaláveis</h2>{sources.length?<div className="members-list">{sources.map(s=>{
  const script=`<script async src="${api}/track/v1/${s.public_key}/script.js"></script>`;
  return <div className="member-row" key={s.id}><div><p><strong>{s.name}</strong><small>{s.allowed_origins.join(" · ")}</small>
   <code>{script}</code><small>{s.events} evento(s) · {s.last_event_at?`último ${new Date(s.last_event_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`:"nenhum recebido"}</small>
   <small>Negócio: {s.business_name??"nenhum"} · Gatilho IC: {triggerLabels[s.ic_trigger_type]??s.ic_trigger_type}{s.ic_trigger_value?` (${s.ic_trigger_value})`:""}{s.product_page?" · ViewContent ativo":""}</small></p>
   {canEdit?<details><summary>Editar vínculo e gatilho</summary><form action={updateTrackingSource}>
    <input type="hidden" name="source_id" value={s.id}/>{metaFields("edit",s)}<button>Salvar alterações</button></form></details>:null}
  </div>
   <span className="member-role">{s.active?"ATIVA":"PAUSADA"}</span>
   {canEdit?<form action={toggleTrackingSource}><input type="hidden" name="source_id" value={s.id}/>
    <input type="hidden" name="active" value={String(!s.active)}/><button>{s.active?"Pausar coleta":"Reativar coleta"}</button></form>:null}
  </div>})}</div>:<div className="compact-empty">Nenhuma fonte criada.</div>}</article></section>
 <div className="method-note"><strong>Instalação</strong><p>Cole a tag antes de &lt;/body&gt;. Marque CTAs com data-fm-cta=&quot;nome&quot;. Para o InitiateCheckout sem mexer no HTML, use o gatilho por seletor CSS, ID ou URL; com acesso ao HTML, data-fm-evento=&quot;InitiateCheckout&quot; no botão também funciona. Formulários registram apenas o envio e seu ID; campos digitados nunca são coletados.</p></div>
 </div></section></main>;
}
