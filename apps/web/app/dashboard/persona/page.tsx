import {redirect} from "next/navigation";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {createClient} from "../../../lib/supabase/server";
import {signOut} from "../actions";
import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
type PageProps={searchParams:Promise<{period?:string}>};
const periods={"30d":{label:"30 dias",days:30},"90d":{label:"90 dias",days:90},
  "365d":{label:"1 ano",days:365},all:{label:"Tudo",days:null}} as const;
type Summary={buyers:number;first_buyers:number;repeat_buyers:number;reversed_buyers:number};
type Ranked={label:string;people:number;orders:number};

export default async function PersonaPage({searchParams}:PageProps){
  const params=await searchParams;
  const periodKey=params.period&&params.period in periods
    ?params.period as keyof typeof periods:"90d";
  const period=periods[periodKey];
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const {project}=await getActiveProject(data.user.id);
  if(!project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const access=`accessible_projects as (
    select project.id from public.projects project
    join public.users app_user on app_user.auth_user_id=$1
    join public.memberships membership on membership.organization_id=project.organization_id
      and membership.user_id=app_user.id
    where project.id=$3 and (not exists(select 1 from public.project_memberships restricted
      where restricted.membership_id=membership.id) or exists(
      select 1 from public.project_memberships allowed
      where allowed.membership_id=membership.id and allowed.project_id=project.id))
  ), selected_orders as (
    select orders.* from public.commerce_orders orders
    where orders.project_id in(select id from accessible_projects)
      and orders.data_scope='production' and orders.person_id is not null
      and ($2::int is null or orders.occurred_at>=now()-($2*interval '1 day'))
  )`;
  const [summaryResult,productsResult,sourcesResult]=await Promise.all([
    database.pool.query<Summary>(`with ${access}, person_orders as (
      select person_id,count(distinct id) filter(where status='approved') approved_orders
      from selected_orders group by person_id
    ), reversed as (
      select distinct orders.person_id from selected_orders orders
      join public.normalized_payment_events event on event.order_id=orders.id
      where event.financial_effect<0
    ) select count(*) filter(where approved_orders>0)::int buyers,
      count(*) filter(where approved_orders=1)::int first_buyers,
      count(*) filter(where approved_orders>1)::int repeat_buyers,
      count(*) filter(where reversed.person_id is not null)::int reversed_buyers
      from person_orders left join reversed using(person_id)`,
    [data.user.id,period.days,project.id]),
    database.pool.query<Ranked>(`with ${access}
      select product.name label,count(distinct orders.person_id)::int people,
        count(distinct orders.id)::int orders
      from selected_orders orders join public.commerce_order_items item on item.order_id=orders.id
      join public.commerce_products product on product.id=item.product_id
      where orders.status='approved' group by product.name
      order by people desc,orders desc,product.name limit 10`,
    [data.user.id,period.days,project.id]),
    database.pool.query<Ranked>(`with ${access}, latest as (
      select distinct on(attribution.order_id) attribution.order_id,
        coalesce(nullif(attribution.utm_source,''),nullif(attribution.src,''),'Não informada') label
      from public.order_attributions attribution join selected_orders orders on orders.id=attribution.order_id
      order by attribution.order_id,attribution.created_at desc
    ) select latest.label,count(distinct orders.person_id)::int people,
      count(distinct orders.id)::int orders
      from selected_orders orders left join latest on latest.order_id=orders.id
      where orders.status='approved'
      group by latest.label order by people desc,orders desc limit 10`,
    [data.user.id,period.days,project.id]),
  ]);
  const summary=summaryResult.rows[0]??{buyers:0,first_buyers:0,repeat_buyers:0,reversed_buyers:0};
  const repeatRate=summary.buyers?summary.repeat_buyers/summary.buyers*100:0;
  const reverseRate=summary.buyers?summary.reversed_buyers/summary.buyers*100:0;
  const ranking=(title:string,rows:Ranked[])=><article className="dashboard-card report-card">
    <header className="card-header"><div><p className="panel-label">Dados observados</p><h2>{title}</h2></div></header>
    {rows.length?<div className="table-scroll"><table className="sales-table report-table">
      <thead><tr><th>Grupo</th><th>Pessoas</th><th>Pedidos aprovados</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.label??"missing"}><td><strong>{row.label??"Não informada"}</strong></td>
        <td>{row.people}</td><td>{row.orders}</td></tr>)}</tbody>
    </table></div>:<div className="chart-empty"><strong>Sem evidência no período</strong></div>}
  </article>;
  return <main className="app-layout">
    <DashboardSidebar activeHref="/dashboard/persona" footerLabel="Evidência agregada"/>
    <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/persona"/>
      <div className="topbar-actions"><span className="data-status"><i/>Sem inferências</span>
        <form action={signOut}><button className="icon-button" type="submit">Sair</button></form></div></header>
      <div className="dashboard-main"><header className="dashboard-titlebar">
        <div><p className="eyebrow">Pesquisa quantitativa</p><h1>Persona observada</h1>
          <p className="dashboard-context">Padrões agregados de compra e origem, sem expor pessoas ou inferir atributos não coletados.</p></div>
        <nav className="period-filter" aria-label="Período">{Object.entries(periods).map(([key,item])=>
          <a key={key} className={key===periodKey?"period-active":undefined}
            href={`/dashboard/persona?period=${key}`}>{item.label}</a>)}</nav></header>
        <section className="quality-summary">
          <article className="kpi-card kpi-primary"><div><span className="kpi-icon">♙</span><p>Compradores</p></div><strong>{summary.buyers}</strong><small>Com aprovação observada</small></article>
          <article className="kpi-card"><div><span className="kpi-icon">1</span><p>Primeira compra</p></div><strong>{summary.first_buyers}</strong><small>Uma compra no período</small></article>
          <article className="kpi-card"><div><span className="kpi-icon">↻</span><p>Recorrência</p></div><strong>{repeatRate.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><small>{summary.repeat_buyers} pessoas recorrentes</small></article>
          <article className="kpi-card"><div><span className="kpi-icon">↩</span><p>Com reversão</p></div><strong>{reverseRate.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><small>{summary.reversed_buyers} pessoas observadas</small></article>
        </section>
        <section className="analytics-grid">{ranking("Produtos presentes nas compras",productsResult.rows)}
          {ranking("Origens registradas",sourcesResult.rows)}</section>
        <div className="method-note"><strong>Limite da leitura</strong><p>Esta tela descreve comportamento comercial agregado. Idade, gênero, profissão, renda, interesses e localização não são exibidos porque não estão comprovados no modelo normalizado.</p></div>
      </div></section>
  </main>;
}
