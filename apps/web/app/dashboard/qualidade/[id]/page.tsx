import {notFound,redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {processingStatusLabel,qualityErrorLabel,validationStatusLabel} from "../../../../lib/data-quality-labels";
import {ProjectSwitcher} from "../../project-switcher";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {retryRawEvent} from "../actions";
export const dynamic="force-dynamic";

type EventRow={id:string;connection_name:string;source:string;external_event_id:string|null;
 external_event_name:string|null;is_test:boolean|null;received_at:Date;processing_status:string;
 validation_status:string;processing_attempts:number;error_code:string|null;parser_version:string};
type AuditRow={id:string;action:string;reason:string|null;occurred_at:Date;
 actor_name:string|null;actor_email:string|null};

export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 const database=getDatabase();
 const [eventResult,auditResult]=await Promise.all([
  database.pool.query<EventRow>(`select event.id,connection.name connection_name,event.source,
   event.external_event_id,event.external_event_name,event.is_test,event.received_at,
   event.processing_status::text,event.validation_status::text,event.processing_attempts,
   event.error_code,event.parser_version from public.raw_events event
   join public.connections connection on connection.id=event.connection_id
   where event.id=$1 and event.project_id=$2 limit 1`,[id,project.id]),
  database.pool.query<AuditRow>(`select audit.id,audit.action,audit.reason,audit.occurred_at,
   app_user.display_name actor_name,app_user.email actor_email from public.audit_logs audit
   left join public.users app_user on app_user.id=audit.actor_user_id
   where audit.project_id=$1 and audit.target_type='raw_event' and audit.target_id=$2
   order by audit.occurred_at desc limit 100`,[project.id,id]),
 ]);
 const event=eventResult.rows[0];if(!event)notFound();
 const canRetry=["owner","administrator"].includes(project.role)&&
  event.processing_status==="failed_retryable";
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/qualidade" footerLabel="Diagnóstico técnico"/>
  <section className="app-content"><header className="app-topbar">
   <ProjectSwitcher returnTo={`/dashboard/qualidade/${id}`}/></header>
   <div className="dashboard-main"><header className="dashboard-titlebar"><div>
    <p className="eyebrow">Diagnóstico seguro</p><h1>{event.external_event_name??"Evento sem nome"}</h1>
    <p className="dashboard-context">Metadados operacionais do evento. Payload e dados pessoais não são consultados nesta tela.</p>
   </div></header>
   <section className="analytics-grid"><article className="dashboard-card"><h2>Processamento</h2>
    <div className="loss-list">
     <div><span>Estado</span><strong>{processingStatusLabel(event.processing_status)}</strong></div>
     <div><span>Validação</span><strong>{validationStatusLabel(event.validation_status)}</strong></div>
     <div><span>Tentativas</span><strong>{event.processing_attempts}</strong></div>
     <div><span>Falha</span><strong>{qualityErrorLabel(event.error_code)??"Nenhuma"}</strong></div>
    </div>{canRetry?<form action={retryRawEvent}><input type="hidden" name="event_id" value={event.id}/>
     <input type="hidden" name="return_period" value="7d"/><input type="hidden" name="return_status" value="failed"/>
     <button type="submit">Tentar novamente</button></form>:null}
   </article><article className="dashboard-card"><h2>Origem</h2><div className="loss-list">
    <div><span>Conexão</span><strong>{event.connection_name}</strong></div>
    <div><span>Fonte</span><strong>{event.source}</strong></div>
    <div><span>Recebido em</span><strong>{event.received_at.toLocaleString("pt-BR")}</strong></div>
    <div><span>Escopo</span><strong>{event.is_test?"Teste":"Produção"}</strong></div>
    <div><span>Parser</span><strong>{event.parser_version}</strong></div>
    <div><span>ID externo</span><strong>{event.external_event_id??"Não informado"}</strong></div>
   </div></article></section>
   <section className="dashboard-card"><header className="card-header"><div>
    <p className="panel-label">Auditoria</p><h2>Histórico da ocorrência</h2></div></header>
    {auditResult.rows.length?<div className="members-list">{auditResult.rows.map(row=>
     <div className="member-row" key={row.id}><p><strong>{row.action}</strong>
      <small>{row.reason??"Ação operacional"}</small></p><small>
       {row.actor_name??row.actor_email??"Sistema"} · {row.occurred_at.toLocaleString("pt-BR")}</small></div>)}</div>:
     <div className="compact-empty">Nenhuma ação manual registrada para este evento.</div>}
   </section></div></section></main>;
}
