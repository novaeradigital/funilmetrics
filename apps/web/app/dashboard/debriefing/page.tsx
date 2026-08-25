import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
const periods={"7d":7,"30d":30,"90d":90} as const;
type Summary={orders:number;buyers:number;gross:string;net:string;reversals:number;orders_with_source:number};
type Ranked={name:string;orders:number;gross:string};

export default async function DebriefingPage({searchParams}:{searchParams:Promise<{period?:string}>}){
  const params=await searchParams;
  const periodKey=params.period&&params.period in periods?params.period as keyof typeof periods:"30d";
  const days=periods[periodKey];
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const database=getDatabase();
  const active=await getActiveProject(data.user.id);
  const scope=active.project?{project_id:active.project.id,project_name:active.project.name,
    currency:active.project.currency}:null;
  if(!scope)redirect("/dashboard");
  const summary=(await database.pool.query<Summary>(
    `with selected_orders as (
       select id,person_id from public.commerce_orders
       where project_id=$1 and data_scope='production'
        and occurred_at>=now()-($2*interval '1 day')
     ), financial as (
       select coalesce(sum(financial_effect) filter(where financial_effect>0),0)::text gross,
        coalesce(sum(financial_effect),0)::text net,
        count(distinct payment_id) filter(where financial_effect<0)::int reversals
       from public.normalized_payment_events where project_id=$1 and data_scope='production'
        and occurred_at>=now()-($2*interval '1 day')
     ), attributed as (
       select count(distinct attribution.order_id)::int orders_with_source
       from public.order_attributions attribution join selected_orders orders on orders.id=attribution.order_id
       where coalesce(nullif(attribution.utm_source,''),nullif(attribution.src,'')) is not null
     )
     select (select count(*)::int from selected_orders) orders,
      (select count(distinct person_id)::int from selected_orders where person_id is not null) buyers,
      financial.*,attributed.orders_with_source from financial cross join attributed`,
    [scope.project_id,days])).rows[0]??{orders:0,buyers:0,gross:"0",net:"0",reversals:0,orders_with_source:0};
  const sources=(await database.pool.query<Ranked>(
    `with selected as (select id from public.commerce_orders where project_id=$1
      and data_scope='production' and occurred_at>=now()-($2*interval '1 day')),
     latest as (select distinct on(a.order_id) a.order_id,
      coalesce(nullif(a.utm_source,''),nullif(a.src,''),'Não informada') name
      from public.order_attributions a join selected s on s.id=a.order_id
      order by a.order_id,a.created_at desc),
     finance as (select order_id,sum(financial_effect) filter(where financial_effect>0) gross
      from public.normalized_payment_events where project_id=$1 and data_scope='production'
      and occurred_at>=now()-($2*interval '1 day') group by order_id)
     select latest.name,count(*)::int orders,coalesce(sum(finance.gross),0)::text gross
     from latest left join finance on finance.order_id=latest.order_id group by latest.name
     order by orders desc,name limit 5`,[scope.project_id,days])).rows;
  const products=(await database.pool.query<Ranked>(
    `with selected as (select id from public.commerce_orders where project_id=$1
      and data_scope='production' and occurred_at>=now()-($2*interval '1 day'))
     select product.name,count(distinct item.order_id)::int orders,'0'::text gross
     from public.commerce_order_items item join selected on selected.id=item.order_id
     join public.commerce_products product on product.id=item.product_id
     group by product.id order by orders desc,product.name limit 5`,
    [scope.project_id,days])).rows;
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:scope.currency||"BRL"});
  const coverage=summary.orders?summary.orders_with_source/summary.orders*100:0;
  return <main className="app-layout">
    <DashboardSidebar activeHref="/dashboard/debriefing" footerLabel="Dados observados"/>
    <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/debriefing"/><form action={signOut}><button className="icon-button">Sair</button></form></header>
      <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Fechamento baseado em evidências</p><h1>Debriefing operacional</h1><p className="dashboard-context">Síntese do que foi observado; causalidade e hipóteses exigem análise separada.</p></div>
        <nav className="period-filter">{Object.entries(periods).map(([key,value])=><Link className={key===periodKey?"period-active":undefined} href={`/dashboard/debriefing?period=${key}`} key={key}>{value} dias</Link>)}</nav></header>
      <section className="quality-summary">
        <article className="kpi-card kpi-primary"><p>Receita bruta</p><strong>{money.format(Number(summary.gross))}</strong><small>efeitos positivos observados</small></article>
        <article className="kpi-card"><p>Receita líquida</p><strong>{money.format(Number(summary.net))}</strong><small>após reversões observadas</small></article>
        <article className="kpi-card"><p>Pedidos</p><strong>{summary.orders}</strong><small>{summary.buyers} pessoas identificadas</small></article>
        <article className="kpi-card"><p>Cobertura de origem</p><strong>{coverage.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</strong><small>{summary.orders_with_source} pedidos com fonte</small></article>
      </section>
      {summary.orders?<div className="integration-config-grid">
        <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Aquisição registrada</p><h2>Principais origens</h2></div></div>
          <div className="table-shell"><table><thead><tr><th>Origem</th><th>Pedidos</th><th>Receita bruta</th></tr></thead><tbody>{sources.map((row)=><tr key={row.name}><td>{row.name}</td><td>{row.orders}</td><td>{money.format(Number(row.gross))}</td></tr>)}</tbody></table></div>
        </section>
        <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Portfólio</p><h2>Produtos presentes</h2></div></div>
          <div className="table-shell"><table><thead><tr><th>Produto</th><th>Pedidos</th></tr></thead><tbody>{products.map((row)=><tr key={row.name}><td>{row.name}</td><td>{row.orders}</td></tr>)}</tbody></table></div>
        </section>
      </div>:<div className="empty-state"><strong>Sem pedidos no período</strong><p>O debriefing permanece vazio até existirem eventos de produção normalizados.</p></div>}
      <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Leitura responsável</p><h2>Conclusões e limitações</h2></div></div>
        <ul><li>{summary.reversals} pagamento(s) distinto(s) com efeito negativo foram observados.</li><li>Origem representa a atribuição mais recente recebida da Lastlink, não um modelo multitoque.</li><li>Produtos representam presença em pedidos; receita não é rateada por item.</li><li>Variações não demonstram causalidade sem desenho experimental.</li></ul>
      </section></div>
    </section>
  </main>;
}
