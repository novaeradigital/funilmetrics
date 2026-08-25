import Link from "next/link";import {redirect} from "next/navigation";import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";import {getDatabase} from "../../../../lib/database";
import {createTrackingSource,toggleTrackingSource} from "./actions";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");const db=getDatabase();
 const sources=(await db.pool.query<{id:string;name:string;public_key:string;allowed_origins:string[];
  active:boolean;events:number;last_event_at:string|null}>(`select s.id,s.name,s.public_key::text,s.allowed_origins,s.active,
  count(e.id)::int events,max(e.received_at)::text last_event_at from public.tracking_sources s
  left join public.tracking_events e on e.tracking_source_id=s.id where s.project_id=$1
  group by s.id order by s.created_at desc`,[project.id])).rows;
 const api=process.env.NEXT_PUBLIC_API_URL??"https://api-production-682c.up.railway.app";
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/integracoes/tracking" footerLabel="Tracking próprio"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/integracoes/tracking" statusLabel="Configuração de tracking"/><div className="dashboard-main">
 {params.status?<div className={["created","updated"].includes(params.status)?"notice notice-success":"notice notice-error"}>
  {["created","updated"].includes(params.status)?"Configuração salva e auditada.":"Não foi possível salvar a configuração."}</div>:null}
 <header className="dashboard-titlebar"><div><p className="eyebrow">Páginas e VSL</p><h1>Tracking próprio</h1>
 <p className="dashboard-context">Crie uma fonte por site, limite as origens e instale uma única tag.</p></div></header>
 <p><Link href="/dashboard/tracking">Abrir métricas coletadas →</Link></p>
 <section className="analytics-grid"><article className="dashboard-card"><h2>Nova fonte</h2><form action={createTrackingSource}>
 <label>Nome<input name="name" placeholder="VSL principal" required/></label>
 <label>Origens autorizadas<textarea name="allowed_origins" placeholder={"https://exemplo.com\nhttps://www.exemplo.com"} required/></label>
 <small>Informe uma origem por linha, sem caminho final.</small><button>Criar fonte</button></form></article>
 <article className="dashboard-card"><h2>Fontes instaláveis</h2>{sources.length?<div className="members-list">{sources.map(s=>{
  const script=`<script async src="${api}/track/v1/${s.public_key}/script.js"></script>`;
  return <div className="member-row" key={s.id}><p><strong>{s.name}</strong><small>{s.allowed_origins.join(" · ")}</small>
   <code>{script}</code><small>{s.events} evento(s) · {s.last_event_at?`último ${new Date(s.last_event_at).toLocaleString("pt-BR")}`:"nenhum recebido"}</small></p>
   <span className="member-role">{s.active?"ATIVA":"PAUSADA"}</span>
   {["owner","administrator"].includes(project.role)?<form action={toggleTrackingSource}><input type="hidden" name="source_id" value={s.id}/>
    <input type="hidden" name="active" value={String(!s.active)}/><button>{s.active?"Pausar coleta":"Reativar coleta"}</button></form>:null}
  </div>})}</div>:<div className="compact-empty">Nenhuma fonte criada.</div>}</article></section>
 <div className="method-note"><strong>Instalação</strong><p>Cole a tag antes de &lt;/body&gt;. Marque CTAs com data-fm-cta=&quot;nome&quot;. Formulários registram apenas o envio e seu ID; campos digitados nunca são coletados.</p></div>
 </div></section></main>;
}
