import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";import {ProjectSwitcher} from "../../project-switcher";
import {DashboardSidebar} from "../../dashboard-sidebar";
export const dynamic="force-dynamic";const PAGE_SIZE=20;
type Row={id:string;scheduled_for:Date;created_at:Date;period_days:number;rule_version:string;
 snapshot:Record<string,unknown>};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;period?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 const requestedPage=Number(params.page??1),validPage=Number.isSafeInteger(requestedPage)&&requestedPage>0?requestedPage:1;
 const period=[7,30,90].includes(Number(params.period))?Number(params.period):null;
 const db=getDatabase(),total=(await db.pool.query<{count:number}>(`select count(*)::int count
  from public.report_snapshots where project_id=$1 and ($2::int is null or period_days=$2)`,
  [project.id,period])).rows[0]?.count??0,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
 const page=Math.min(validPage,pages);
 const rows=(await db.pool.query<Row>(`select id,scheduled_for,created_at,period_days,
  rule_version,snapshot from public.report_snapshots
  where project_id=$1 and ($2::int is null or period_days=$2)
  order by scheduled_for desc limit $3 offset $4`,[project.id,period,PAGE_SIZE,(page-1)*PAGE_SIZE])).rows;
 const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency});
 const query=(target:number)=>`/dashboard/relatorios/snapshots?page=${target}${period?`&period=${period}`:""}`;
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/relatorios/snapshots" footerLabel="Snapshots imutáveis"/>
 <section className="app-content"><header className="app-topbar">
  <ProjectSwitcher returnTo="/dashboard/relatorios/snapshots"/></header><div className="dashboard-main">
  <header className="dashboard-titlebar"><div><p className="eyebrow">Fechamentos preservados</p><h1>Histórico de snapshots</h1>
   <p className="dashboard-context">{total} fechamento(s) no projeto atual. A consulta não recalcula valores históricos.</p>
   <Link className="export-button" href="/dashboard/relatorios/snapshots/comparar">Comparar snapshots</Link></div>
   <nav className="period-filter"><Link className={!period?"period-active":undefined} href="/dashboard/relatorios/snapshots">Todos</Link>
    {[7,30,90].map(value=><Link className={period===value?"period-active":undefined}
     href={`/dashboard/relatorios/snapshots?period=${value}`} key={value}>{value} dias</Link>)}</nav></header>
  <section className="dashboard-card">{rows.length?<div className="table-scroll"><table className="sales-table">
   <thead><tr><th>Agendado para</th><th>Janela</th><th>Regra</th><th>Receita líquida</th><th>Aprovados</th><th></th></tr></thead>
   <tbody>{rows.map(row=><tr key={row.id}><td>{row.scheduled_for.toLocaleString("pt-BR")}</td>
    <td>{row.period_days} dias</td><td>{row.rule_version}</td>
    <td>{money.format(Number(row.snapshot.net_revenue??0))}</td><td>{Number(row.snapshot.approved_payments??0)}</td>
    <td><Link href={`/dashboard/relatorios/snapshots/${row.id}`}>Conferir</Link></td></tr>)}</tbody>
   </table></div>:<div className="compact-empty">Nenhum snapshot encontrado para este filtro.</div>}
   {total>PAGE_SIZE?<nav className="pagination-controls">
    {page>1?<Link href={query(page-1)}>Anterior</Link>:<span/>}<span>Página {page} de {pages}</span>
    {page<pages?<Link href={query(page+1)}>Próxima</Link>:<span/>}</nav>:null}</section>
  </div></section></main>;
}
