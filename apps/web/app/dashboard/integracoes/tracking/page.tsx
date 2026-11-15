import Link from "next/link";import {redirect} from "next/navigation";import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";import {getDatabase} from "../../../../lib/database";
import {createTrackingSource,toggleTrackingSource,updateTrackingSource} from "./actions";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {TrackingTabs} from "../../tracking/tabs";
import {TriggerFields} from "./trigger-fields";
export const dynamic="force-dynamic";
const triggerLabels:Record<string,string>={attribute:"Atributo no elemento",selector:"Seletor CSS",id:"ID do elemento",url:"URL específica",url_part:"Trecho da URL",domain:"Domínio do link"};
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");const db=getDatabase();
 const businesses=(await db.pool.query<{id:string;name:string}>(`select id::text as id,name
  from public.business_projects where project_id=$1 order by name`,[project.id])).rows;
 const sources=(await db.pool.query<{id:string;name:string;public_key:string;allowed_origins:string[];
  active:boolean;events:number;last_event_at:string|null;business_project_id:string|null;business_name:string|null;
  ic_trigger_type:string;ic_trigger_value:string|null;ic_triggers:{type:string;value:string|null;label:string}[]|null;product_page:boolean}>(`select s.id,s.name,s.public_key::text,s.allowed_origins,s.active,
  count(e.id)::int events,max(e.received_at)::text last_event_at,s.business_project_id::text,
  b.name as business_name,s.ic_trigger_type,s.ic_trigger_value,s.ic_triggers,s.product_page from public.tracking_sources s
  left join public.business_projects b on b.id=s.business_project_id
  left join public.tracking_events e on e.tracking_source_id=s.id where s.project_id=$1
  group by s.id,b.name order by s.created_at desc`,[project.id])).rows;
 const api=process.env.NEXT_PUBLIC_API_URL??"https://api.funilmetrics.site";
 const canEdit=["owner","administrator"].includes(project.role);
 type Rule={type:string;value:string|null;label:string};
 const rulesOf=(holder?:{ic_trigger_type:string;ic_trigger_value:string|null;ic_triggers:Rule[]|null}|null):Rule[]=>
  holder?.ic_triggers&&holder.ic_triggers.length?holder.ic_triggers
   :[{type:holder?.ic_trigger_type??"attribute",value:holder?.ic_trigger_value??null,label:""}];
 const metaFields=(prefix:string,current?:{business_project_id:string|null;ic_trigger_type:string;ic_trigger_value:string|null;ic_triggers:Rule[]|null;product_page:boolean})=>(<>
  <label>Projeto de negócio<select name="business_project_id" defaultValue={current?.business_project_id??""}>
   <option value="">Sem negócio (não envia para a Meta)</option>
   {businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  <TriggerFields initial={rulesOf(current).map(r=>({type:r.type,value:r.value??"",label:r.label??""}))}/>
  <label><input name="product_page" type="checkbox" defaultChecked={current?.product_page??false}/> Página de produto (dispara ViewContent)</label>
 </>);
 return <main className="app-layout fontes-page"><DashboardSidebar activeHref="/dashboard/tracking" footerLabel="Tracking próprio"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/integracoes/tracking" statusLabel="Configuração de tracking"/><div className="dashboard-main">
 <TrackingTabs active="sources"/>
 {params.status?<div className={["created","updated"].includes(params.status)?"notice notice-success":"notice notice-error"}>
  {["created","updated"].includes(params.status)?"Configuração salva e auditada.":"Não foi possível salvar a configuração."}</div>:null}
 <header className="dashboard-titlebar"><div><p className="eyebrow">Rastreamento · Fontes</p><h1>Fontes e script</h1>
 <p className="dashboard-context">Crie uma fonte por site, limite as origens, vincule ao projeto de negócio e instale uma única tag.</p></div></header>
 <p><Link href="/dashboard/tracking">Abrir métricas coletadas →</Link></p>
 <details className="source-create"><summary><span className="source-create-plus">+</span><span><strong>Cadastrar nova fonte</strong><small>Crie uma fonte por site, limite as origens e vincule ao projeto de negócio.</small></span></summary><div className="source-create-body"><form action={createTrackingSource}>
 <label>Nome<input name="name" placeholder="VSL principal" required/></label>
 <label>Origens autorizadas<textarea name="allowed_origins" placeholder={"https://exemplo.com\nhttps://www.exemplo.com"} required/></label>
 <small>Informe uma origem por linha, sem caminho final.</small>
 {metaFields("create")}
 <button>Criar fonte</button></form></div></details>
 <section className="source-list"><div className="source-list-head"><h2>Fontes cadastradas</h2><span>{sources.length} fonte(s)</span></div>{sources.length?<div className="source-grid">{sources.map(s=>{
  const script=`<script async src="${api}/track/v1/${s.public_key}/script.js"></script>`;
  const rules=rulesOf(s);
  return <article className="source-card" key={s.id}><header><span className="source-avatar">{s.name.slice(0,1).toUpperCase()}</span><div><strong>{s.name}</strong><small>{s.allowed_origins.join(" · ")}</small></div><span className={s.active?"source-status is-on":"source-status"}>{s.active?"ATIVA":"PAUSADA"}</span></header>
   <code className="source-script">{script}</code>
   <dl className="source-facts"><div><dt>Eventos</dt><dd>{s.events} evento(s) · {s.last_event_at?`último ${new Date(s.last_event_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`:"nenhum recebido"}</dd></div>
   <div><dt>Negócio</dt><dd>{s.business_name??"nenhum"}</dd></div>
   <div><dt>Gatilho do IC</dt><dd>{rules.length} regra(s): {rules.map(r=>r.label?`${r.label} (${r.value??triggerLabels[r.type]??r.type})`:(r.value??triggerLabels[r.type]??r.type)).join(" · ")}</dd></div>
   <div><dt>ViewContent</dt><dd>{s.product_page?"Ativo (página de produto)":"Não ativo"}</dd></div></dl>
   {canEdit?<details className="source-edit"><summary>Editar vínculo e gatilho</summary><form action={updateTrackingSource}>
    <input type="hidden" name="source_id" value={s.id}/>{metaFields("edit",s)}<button>Salvar alterações</button></form></details>:null}
   {canEdit?<form action={toggleTrackingSource} className="source-toggle"><input type="hidden" name="source_id" value={s.id}/>
    <input type="hidden" name="active" value={String(!s.active)}/><button>{s.active?"Pausar coleta":"Reativar coleta"}</button></form>:null}
  </article>})}</div>:<div className="compact-empty">Nenhuma fonte criada.</div>}</section>
 <div className="method-note"><strong>Instalação</strong><p>Cole a tag antes de &lt;/body&gt;. Marque CTAs com data-fm-cta=&quot;nome&quot;. Para o InitiateCheckout sem mexer no HTML, use o gatilho por seletor CSS, ID ou URL; com acesso ao HTML, data-fm-evento=&quot;InitiateCheckout&quot; no botão também funciona. Formulários registram apenas o envio e seu ID; campos digitados nunca são coletados.</p></div>
 </div></section></main>;
}
