import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";import {ProjectSwitcher} from "../../project-switcher";
import {DashboardSidebar} from "../../dashboard-sidebar";
export const dynamic="force-dynamic";const PAGE_SIZE=25;
type Row={id:string;title:string;issue_type:string;severity:string;status:string;occurrences:number;
 first_detected_at:Date;last_detected_at:Date;resolved_at:Date|null;rule_version:string;
 connection_name:string|null;evidence:Record<string,unknown>};
export default async function Page({searchParams}:{searchParams:Promise<{
 page?:string;status?:string;severity?:string;q?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 const status=["open","resolved"].includes(params.status??"")?params.status!:"";
 const severity=["critical","warning","info"].includes(params.severity??"")?params.severity!:"";
 const search=(params.q??"").trim().slice(0,100);
 const requested=Number(params.page??1),validPage=Number.isSafeInteger(requested)&&requested>0?requested:1;
 const db=getDatabase(),values=[project.id,status,severity,search];
 const total=(await db.pool.query<{count:number}>(`select count(*)::int count from public.data_quality_issues issue
  where issue.project_id=$1 and ($2='' or issue.status=$2) and ($3='' or issue.severity=$3)
   and ($4='' or issue.title ilike '%'||$4||'%' or issue.issue_type ilike '%'||$4||'%')`,values)).rows[0]?.count??0;
 const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(validPage,pages);
 const rows=(await db.pool.query<Row>(`select issue.id,issue.title,issue.issue_type,issue.severity,
  issue.status,issue.occurrences,issue.first_detected_at,issue.last_detected_at,issue.resolved_at,
  issue.rule_version,issue.evidence,connection.name connection_name
  from public.data_quality_issues issue left join public.connections connection on connection.id=issue.connection_id
  where issue.project_id=$1 and ($2='' or issue.status=$2) and ($3='' or issue.severity=$3)
   and ($4='' or issue.title ilike '%'||$4||'%' or issue.issue_type ilike '%'||$4||'%')
  order by case when issue.status='open' then 0 else 1 end,issue.last_detected_at desc
  limit $5 offset $6`,[...values,PAGE_SIZE,(page-1)*PAGE_SIZE])).rows;
 const query=(target:number)=>{const p=new URLSearchParams();p.set("page",String(target));
  if(status)p.set("status",status);if(severity)p.set("severity",severity);if(search)p.set("q",search);return `?${p}`};
 const exportParams=new URLSearchParams();if(status)exportParams.set("status",status);
 if(severity)exportParams.set("severity",severity);if(search)exportParams.set("q",search);
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/alertas/historico" footerLabel="Histórico preservado"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/alertas/historico"/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Monitor persistente</p>
   <h1>Histórico de ocorrências</h1><p className="dashboard-context">{total} ocorrência(s) no projeto atual, incluindo resolvidas.</p></div>
   <Link className="export-button" href={`/dashboard/alertas/historico/export?${exportParams}`}>Exportar filtro</Link></header>
  <section className="dashboard-card"><form className="inline-filter-form"><label>Busca<input name="q" defaultValue={search} placeholder="Título ou tipo"/></label>
   <label>Estado<select name="status" defaultValue={status}><option value="">Todos</option><option value="open">Aberto</option>
    <option value="resolved">Resolvido</option></select></label>
   <label>Severidade<select name="severity" defaultValue={severity}><option value="">Todas</option>
    <option value="critical">Crítico</option><option value="warning">Atenção</option><option value="info">Informativo</option></select></label>
   <button>Filtrar</button><Link className="icon-button" href="/dashboard/alertas/historico">Limpar</Link></form></section>
  <section className="dashboard-card">{rows.length?<div className="table-scroll"><table className="sales-table">
   <thead><tr><th>Ocorrência</th><th>Severidade</th><th>Estado</th><th>Avaliações</th><th>Última detecção</th><th>Regra</th></tr></thead>
   <tbody>{rows.map(row=><tr key={row.id}><td><Link href={`/dashboard/alertas/historico/${row.id}`}><strong>{row.title}</strong></Link>
    <small>{row.issue_type} · {row.connection_name??"Projeto"}</small></td>
    <td>{row.severity}</td><td>{row.status}</td><td>{row.occurrences}</td>
    <td>{row.last_detected_at.toLocaleString("pt-BR")}</td><td>{row.rule_version}</td></tr>)}</tbody></table></div>:
   <div className="compact-empty">Nenhuma ocorrência encontrada para os filtros.</div>}
   {total>PAGE_SIZE?<nav className="pagination-controls">{page>1?<Link href={query(page-1)}>Anterior</Link>:<span/>}
    <span>Página {page} de {pages}</span>{page<pages?<Link href={query(page+1)}>Próxima</Link>:<span/>}</nav>:null}</section>
  </div></section></main>;
}
