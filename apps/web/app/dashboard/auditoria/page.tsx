import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";
export const dynamic="force-dynamic";const PAGE_SIZE=30;
type Row={id:string;project_id:string|null;action:string;target_type:string;target_id:string|null;reason:string|null;
 occurred_at:Date;actor_name:string|null;actor_email:string|null};
export default async function Page({searchParams}:{searchParams:Promise<{
 page?:string;action?:string;target?:string;q?:string;from?:string;to?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");const canView=["owner","administrator"].includes(project.role);
 if(!canView)return <main className="app-layout"><section className="app-content"><div className="dashboard-main">
  <div className="permission-state"><strong>Auditoria restrita</strong><p>Somente proprietários e administradores podem consultar esta trilha.</p>
  <Link href="/dashboard">Voltar à visão geral</Link></div></div></section></main>;
 const action=(params.action??"").trim().slice(0,100),target=(params.target??"").trim().slice(0,100);
 const search=(params.q??"").trim().slice(0,100),from=/^\d{4}-\d{2}-\d{2}$/.test(params.from??"")?params.from!:"",
  to=/^\d{4}-\d{2}-\d{2}$/.test(params.to??"")?params.to!:"",requested=Number(params.page??1);
 const validPage=Number.isSafeInteger(requested)&&requested>0?requested:1,db=getDatabase();
 const values=[project.id,action,target,search,from,to];
 const where=`(audit.project_id=$1 or (audit.project_id is null and audit.organization_id=
  (select organization_id from public.projects where id=$1)))
  and ($2='' or audit.action=$2) and ($3='' or audit.target_type=$3)
  and ($4='' or audit.action ilike '%'||$4||'%' or coalesce(audit.target_id,'') ilike '%'||$4||'%'
   or coalesce(audit.request_id,'') ilike '%'||$4||'%'
   or coalesce(app_user.display_name,app_user.email,'') ilike '%'||$4||'%')
  and ($5='' or audit.occurred_at>=$5::date) and ($6='' or audit.occurred_at<$6::date+1)`;
 const summary=(await db.pool.query<{count:number;human_count:number;system_count:number;recent_count:number}>(
  `select count(*)::int count,
   count(*) filter(where audit.actor_user_id is not null)::int human_count,
   count(*) filter(where audit.actor_user_id is null)::int system_count,
   count(*) filter(where audit.occurred_at>=now()-interval '24 hours')::int recent_count
   from public.audit_logs audit left join public.users app_user on app_user.id=audit.actor_user_id
   where ${where}`,values)).rows[0]??{count:0,human_count:0,system_count:0,recent_count:0};
 const total=summary.count;
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(validPage,pages);
 const rows=(await db.pool.query<Row>(`select audit.id,audit.project_id,audit.action,audit.target_type,audit.target_id,
  audit.reason,audit.occurred_at,app_user.display_name actor_name,app_user.email actor_email
  from public.audit_logs audit left join public.users app_user on app_user.id=audit.actor_user_id
  where ${where} order by audit.occurred_at desc limit $7 offset $8`,
  [...values,PAGE_SIZE,(page-1)*PAGE_SIZE])).rows;
 const options=(await db.pool.query<{action:string;target_type:string}>(`select distinct action,target_type
  from public.audit_logs audit where (audit.project_id=$1 or (audit.project_id is null and
   audit.organization_id=(select organization_id from public.projects where id=$1)))
  order by action,target_type`,[project.id])).rows;
 const filteredParams=()=>{const p=new URLSearchParams();
  if(action)p.set("action",action);if(target)p.set("target",target);if(search)p.set("q",search);
  if(from)p.set("from",from);if(to)p.set("to",to);return `?${p}`};
 const query=(targetPage:number)=>{const p=new URLSearchParams(filteredParams().slice(1));p.set("page",String(targetPage));return `?${p}`};
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/auditoria" footerLabel="Trilha imutável"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/auditoria"/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Governança do projeto</p>
   <h1>Trilha de auditoria</h1><p className="dashboard-context">{total} ação(ões) preservada(s). Segredos são redigidos antes da exibição.</p></div></header>
  <section className="executive-grid">
   <article className="kpi-card kpi-primary"><div><p>Ações filtradas</p></div><strong>{total}</strong><small>Escopo atual</small></article>
   <article className="kpi-card"><div><p>Ações humanas</p></div><strong>{summary.human_count}</strong><small>Ator identificado</small></article>
   <article className="kpi-card"><div><p>Ações do sistema</p></div><strong>{summary.system_count}</strong><small>Automação ou processo</small></article>
   <article className="kpi-card"><div><p>Últimas 24 horas</p></div><strong>{summary.recent_count}</strong><small>Dentro dos filtros</small></article>
  </section>
  <section className="dashboard-card"><form className="inline-filter-form"><label>Busca<input name="q" defaultValue={search} placeholder="Ação, alvo, ator ou Request ID"/></label>
   <label>Ação<select name="action" defaultValue={action}><option value="">Todas</option>{[...new Set(options.map(item=>item.action))].map(item=>
    <option value={item} key={item}>{item}</option>)}</select></label>
   <label>Tipo de alvo<select name="target" defaultValue={target}><option value="">Todos</option>{[...new Set(options.map(item=>item.target_type))].map(item=>
    <option value={item} key={item}>{item}</option>)}</select></label>
   <label>De<input type="date" name="from" defaultValue={from}/></label>
   <label>Até<input type="date" name="to" defaultValue={to}/></label><button>Filtrar</button>
   <Link className="icon-button" href="/dashboard/auditoria">Limpar</Link>
   <a className="icon-button" href={`/dashboard/auditoria/export${filteredParams()}`}>Exportar CSV</a></form></section>
  <section className="dashboard-card">{rows.length?<div className="table-scroll"><table className="sales-table">
   <thead><tr><th>Quando</th><th>Ação</th><th>Alvo</th><th>Ator</th><th>Motivo</th></tr></thead>
   <tbody>{rows.map(row=><tr key={row.id}><td>{row.occurred_at.toLocaleString("pt-BR")}</td>
    <td><Link href={`/dashboard/auditoria/${row.id}`}><strong>{row.action}</strong></Link></td>
    <td>{row.project_id?row.target_type:`Organização · ${row.target_type}`}<small>{row.target_id??"—"}</small></td>
    <td>{row.actor_name??row.actor_email??"Sistema"}</td><td>{row.reason??"—"}</td></tr>)}</tbody></table></div>:
   <div className="compact-empty">Nenhuma ação encontrada para os filtros.</div>}
   {total>PAGE_SIZE?<nav className="pagination-controls">{page>1?<Link href={query(page-1)}>Anterior</Link>:<span/>}
    <span>Página {page} de {pages}</span>{page<pages?<Link href={query(page+1)}>Próxima</Link>:<span/>}</nav>:null}</section>
  </div></section></main>;
}
