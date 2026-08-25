import Link from "next/link";import {notFound,redirect} from "next/navigation";
import {createClient} from "../../../../../lib/supabase/server";
import {getActiveProject} from "../../../../../lib/active-project";
import {getDatabase} from "../../../../../lib/database";import {ProjectSwitcher} from "../../../project-switcher";
import {DashboardSidebar} from "../../../dashboard-sidebar";
export const dynamic="force-dynamic";
type Snapshot={id:string;scheduled_for:Date;period_days:number;rule_version:string;
 snapshot:Record<string,unknown>;created_at:Date};
const number=(value:unknown)=>typeof value==="number"?value:Number(value??0);
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const item=(await getDatabase().pool.query<Snapshot>(`select id,scheduled_for,period_days,
  rule_version,snapshot,created_at from public.report_snapshots where id=$1 and project_id=$2`,
  [id,project.id])).rows[0];if(!item)notFound();
 const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency});
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/relatorios/snapshots" footerLabel="Snapshot imutável"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo={`/dashboard/relatorios/snapshots/${id}`}/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Snapshot imutável</p>
  <h1>Fechamento financeiro</h1><p className="dashboard-context">Gerado para {item.scheduled_for.toLocaleString("pt-BR")} · janela de {item.period_days} dias · regra {item.rule_version}.</p>
  <Link className="export-button" href={`/dashboard/relatorios/snapshots/${id}/export`}>Baixar este snapshot</Link></div></header>
  <section className="executive-grid"><article className="kpi-card kpi-primary"><div><p>Receita bruta</p></div>
   <strong>{money.format(number(item.snapshot.gross_revenue))}</strong></article>
   <article className="kpi-card"><div><p>Receita líquida</p></div>
   <strong>{money.format(number(item.snapshot.net_revenue))}</strong></article>
   <article className="kpi-card"><div><p>Pagamentos aprovados</p></div>
   <strong>{number(item.snapshot.approved_payments)}</strong></article>
   <article className="kpi-card"><div><p>Pagamentos revertidos</p></div>
   <strong>{number(item.snapshot.reversed_payments)}</strong></article></section>
  <section className="dashboard-card"><h2>Evidência preservada</h2><p>{number(item.snapshot.observed_events)} evento(s) financeiros de produção observados no corte.</p>
   <small>Registro criado em {item.created_at.toLocaleString("pt-BR")}. Este painel lê o JSON armazenado e não recalcula valores históricos.</small></section>
  <div className="method-note"><strong>Regra financeira</strong><p>Receita bruta soma efeitos positivos; receita líquida inclui efeitos negativos. Pagamentos são deduplicados por identificador conforme a regra registrada.</p></div>
  </div></section></main>;
}
