import {notFound,redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";import {sanitizeAuditValue} from "../../../../lib/audit-sanitizer";
import {ProjectSwitcher} from "../../project-switcher";export const dynamic="force-dynamic";
import {DashboardSidebar} from "../../dashboard-sidebar";
type Row={id:string;project_id:string|null;action:string;target_type:string;target_id:string|null;reason:string|null;
 before:unknown;after:unknown;metadata:unknown;request_id:string|null;occurred_at:Date;
 actor_name:string|null;actor_email:string|null};
const block=(value:unknown)=>JSON.stringify(sanitizeAuditValue(value),null,2);
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 if(!["owner","administrator"].includes(project.role))redirect("/dashboard/auditoria");
 const item=(await getDatabase().pool.query<Row>(`select audit.id,audit.project_id,audit.action,audit.target_type,
  audit.target_id,audit.reason,audit.before,audit.after,audit.metadata,audit.request_id,
  audit.occurred_at,app_user.display_name actor_name,app_user.email actor_email
  from public.audit_logs audit left join public.users app_user on app_user.id=audit.actor_user_id
  where audit.id=$1 and (audit.project_id=$2 or (audit.project_id is null and audit.organization_id=
   (select organization_id from public.projects where id=$2)))`,[id,project.id])).rows[0];if(!item)notFound();
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/auditoria" footerLabel="Registro auditável"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo={`/dashboard/auditoria/${id}`}/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Registro imutável</p>
   <h1>{item.action}</h1><p className="dashboard-context">{item.occurred_at.toLocaleString("pt-BR")} · {item.actor_name??item.actor_email??"Sistema"}</p></div></header>
  <section className="dashboard-card"><p><strong>Escopo</strong><br/>{item.project_id?"Projeto atual":"Organização"}</p>
   <p><strong>Alvo</strong><br/>{item.target_type} · {item.target_id??"sem identificador"}</p>
   <p><strong>Motivo</strong><br/>{item.reason??"Não informado"}</p><p><strong>Request ID</strong><br/><code>{item.request_id??"Não informado"}</code></p></section>
  <section className="analytics-grid"><article className="dashboard-card"><h2>Antes</h2>
   {item.before?<pre>{block(item.before)}</pre>:<div className="compact-empty">Sem estado anterior registrado.</div>}</article>
   <article className="dashboard-card"><h2>Depois</h2>{item.after?<pre>{block(item.after)}</pre>:
    <div className="compact-empty">Sem estado posterior registrado.</div>}</article></section>
  <section className="dashboard-card"><h2>Metadados sanitizados</h2>{item.metadata?<pre>{block(item.metadata)}</pre>:
   <div className="compact-empty">Sem metadados adicionais.</div>}</section>
  <div className="method-note"><strong>Redação defensiva</strong><p>Campos com nomes de token, segredo, senha, autorização ou chave são ocultados mesmo se uma integração os registrar indevidamente.</p></div>
  </div></section></main>;
}
