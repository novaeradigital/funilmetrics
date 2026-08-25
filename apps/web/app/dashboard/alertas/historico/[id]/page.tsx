import {notFound,redirect} from "next/navigation";
import {createClient} from "../../../../../lib/supabase/server";import {getActiveProject} from "../../../../../lib/active-project";
import {getDatabase} from "../../../../../lib/database";import {ProjectSwitcher} from "../../../project-switcher";
import {DashboardSidebar} from "../../../dashboard-sidebar";
export const dynamic="force-dynamic";
type Row={id:string;title:string;issue_type:string;issue_key:string;severity:string;status:string;
 occurrences:number;first_detected_at:Date;last_detected_at:Date;resolved_at:Date|null;
 rule_version:string;connection_name:string|null;evidence:Record<string,unknown>};
const display=(value:unknown)=>value===null?"—":typeof value==="object"?JSON.stringify(value):String(value);
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const item=(await getDatabase().pool.query<Row>(`select issue.id,issue.title,issue.issue_type,
  issue.issue_key,issue.severity,issue.status,issue.occurrences,issue.first_detected_at,
  issue.last_detected_at,issue.resolved_at,issue.rule_version,issue.evidence,
  connection.name connection_name from public.data_quality_issues issue
  left join public.connections connection on connection.id=issue.connection_id
  where issue.id=$1 and issue.project_id=$2`,[id,project.id])).rows[0];if(!item)notFound();
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/alertas/historico" footerLabel="Evidência preservada"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo={`/dashboard/alertas/historico/${id}`}/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Ocorrência persistente</p>
   <h1>{item.title}</h1><p className="dashboard-context">{item.issue_type} · {item.connection_name??"Escopo do projeto"} · regra {item.rule_version}</p></div></header>
  <section className="executive-grid"><article className="kpi-card"><div><p>Severidade</p></div><strong>{item.severity}</strong></article>
   <article className="kpi-card"><div><p>Estado</p></div><strong>{item.status}</strong></article>
   <article className="kpi-card"><div><p>Avaliações</p></div><strong>{item.occurrences}</strong></article>
   <article className="kpi-card"><div><p>Última detecção</p></div><strong>{item.last_detected_at.toLocaleDateString("pt-BR")}</strong></article></section>
  <section className="analytics-grid"><article className="dashboard-card"><h2>Evidência registrada</h2>
   {Object.keys(item.evidence).length?<div className="members-list">{Object.entries(item.evidence).map(([key,value])=>
    <div className="member-row" key={key}><p><strong>{key}</strong><small>{display(value)}</small></p></div>)}</div>:
    <div className="compact-empty">A regra não registrou campos adicionais de evidência.</div>}</article>
   <article className="dashboard-card"><h2>Linha do tempo</h2><p><strong>Primeira detecção</strong><br/>{item.first_detected_at.toLocaleString("pt-BR")}</p>
    <p><strong>Última detecção</strong><br/>{item.last_detected_at.toLocaleString("pt-BR")}</p>
    <p><strong>Resolução</strong><br/>{item.resolved_at?.toLocaleString("pt-BR")??"Ainda aberta"}</p>
    <p><strong>Chave idempotente</strong><br/><code>{item.issue_key}</code></p></article></section>
  <div className="method-note"><strong>Histórico protegido</strong><p>Esta tela é somente leitura. A ocorrência é aberta, atualizada e resolvida pelo monitor conforme a regra registrada.</p></div>
  </div></section></main>;
}
