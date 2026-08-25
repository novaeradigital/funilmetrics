import {redirect} from "next/navigation";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {createClient} from "../../../lib/supabase/server";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";

export const dynamic="force-dynamic";

type PageProps={searchParams:Promise<{cohort?:string}>};
const cohorts={
  "90d":{label:"90 dias",days:90},
  "365d":{label:"1 ano",days:365},
  all:{label:"Todo histórico",days:null},
} as const;

type LtvSummary={
  cohort_people:number;
  eligible_30:number;ltv_30:string;
  eligible_90:number;ltv_90:string;
  eligible_365:number;ltv_365:string;
  lifetime_net:string;
};
type CohortMonth={
  cohort_month:string;
  people:number;
  lifetime_net:string;
  average_lifetime_net:string;
};

export default async function LtvPage({searchParams}:PageProps){
  const params=await searchParams;
  const cohortKey=params.cohort&&params.cohort in cohorts
    ?params.cohort as keyof typeof cohorts:"365d";
  const cohort=cohorts[cohortKey];
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const {project}=await getActiveProject(data.user.id);
  if(!project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const base=`accessible_projects as (
    select project.id from public.projects project
    join public.users app_user on app_user.auth_user_id=$1
    join public.memberships membership
      on membership.organization_id=project.organization_id
     and membership.user_id=app_user.id
    where project.id=$3 and (
      not exists(select 1 from public.project_memberships restricted
        where restricted.membership_id=membership.id)
      or exists(select 1 from public.project_memberships allowed
        where allowed.membership_id=membership.id and allowed.project_id=project.id)
    )
  ), first_purchase as (
    select orders.person_id,min(event.occurred_at) first_purchase_at
    from public.normalized_payment_events event
    join public.commerce_orders orders on orders.id=event.order_id
    where event.project_id in(select id from accessible_projects)
      and event.data_scope='production' and event.financial_effect>0
      and orders.data_scope='production'
      and orders.person_id is not null
    group by orders.person_id
  ), cohort_people as (
    select * from first_purchase
    where ($2::int is null or first_purchase_at>=now()-($2*interval '1 day'))
  ), person_value as (
    select cohort.person_id,cohort.first_purchase_at,
      coalesce(sum(event.financial_effect)
        filter(where event.occurred_at<cohort.first_purchase_at+interval '30 days'),0) net_30,
      coalesce(sum(event.financial_effect)
        filter(where event.occurred_at<cohort.first_purchase_at+interval '90 days'),0) net_90,
      coalesce(sum(event.financial_effect)
        filter(where event.occurred_at<cohort.first_purchase_at+interval '365 days'),0) net_365,
      coalesce(sum(event.financial_effect),0) lifetime_net
    from cohort_people cohort
    left join public.commerce_orders orders on orders.person_id=cohort.person_id
      and orders.project_id=$3 and orders.data_scope='production'
    left join public.normalized_payment_events event on event.order_id=orders.id
      and event.project_id=$3 and event.data_scope='production'
      and event.occurred_at>=cohort.first_purchase_at
    group by cohort.person_id,cohort.first_purchase_at
  )`;
  const [summaryResult,monthsResult]=await Promise.all([
    database.pool.query<LtvSummary>(`with ${base}
      select count(*)::int cohort_people,
        count(*) filter(where first_purchase_at<=now()-interval '30 days')::int eligible_30,
        coalesce(avg(net_30) filter(where first_purchase_at<=now()-interval '30 days'),0)::text ltv_30,
        count(*) filter(where first_purchase_at<=now()-interval '90 days')::int eligible_90,
        coalesce(avg(net_90) filter(where first_purchase_at<=now()-interval '90 days'),0)::text ltv_90,
        count(*) filter(where first_purchase_at<=now()-interval '365 days')::int eligible_365,
        coalesce(avg(net_365) filter(where first_purchase_at<=now()-interval '365 days'),0)::text ltv_365,
        coalesce(sum(lifetime_net),0)::text lifetime_net
      from person_value`,[data.user.id,cohort.days,project.id]),
    database.pool.query<CohortMonth>(`with ${base}
      select to_char(date_trunc('month',first_purchase_at),'YYYY-MM-01') cohort_month,
        count(*)::int people,sum(lifetime_net)::text lifetime_net,
        avg(lifetime_net)::text average_lifetime_net
      from person_value group by date_trunc('month',first_purchase_at)
      order by date_trunc('month',first_purchase_at) desc limit 24`,
    [data.user.id,cohort.days,project.id]),
  ]);
  const summary=summaryResult.rows[0]??{
    cohort_people:0,eligible_30:0,ltv_30:"0",eligible_90:0,ltv_90:"0",
    eligible_365:0,ltv_365:"0",lifetime_net:"0",
  };
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency});
  const month=new Intl.DateTimeFormat("pt-BR",{month:"short",year:"numeric",timeZone:"UTC"});
  return <main className="app-layout">
    <DashboardSidebar activeHref="/dashboard/ltv" footerLabel="Regra LTV v1"/>
    <section className="app-content">
      <DashboardTopbar returnTo="/dashboard/ltv" statusLabel="Produção">
        <nav className="period-filter topbar-period-filter" aria-label="Coorte de primeira compra">
          {Object.entries(cohorts).map(([key,item])=>
            <a key={key} className={key===cohortKey?"period-active":undefined}
              href={`/dashboard/ltv?cohort=${key}`}>{item.label}</a>)}
        </nav>
      </DashboardTopbar>
      <div className="dashboard-main">
        <header className="dashboard-titlebar">
          <div><p className="eyebrow">Valor por pessoa</p><h1>LTV observado</h1>
            <p className="dashboard-context">Receita líquida desde a primeira compra aprovada, sem previsão ou atribuição artificial.</p></div>
        </header>
        <section className="quality-summary">
          <article className="kpi-card"><div><span className="kpi-icon">30</span><p>LTV líquido 30d</p></div>
            <strong>{money.format(Number(summary.ltv_30))}</strong><small>{summary.eligible_30} pessoas com janela completa</small></article>
          <article className="kpi-card kpi-primary"><div><span className="kpi-icon">90</span><p>LTV líquido 90d</p></div>
            <strong>{money.format(Number(summary.ltv_90))}</strong><small>{summary.eligible_90} pessoas com janela completa</small></article>
          <article className="kpi-card"><div><span className="kpi-icon">365</span><p>LTV líquido 365d</p></div>
            <strong>{money.format(Number(summary.ltv_365))}</strong><small>{summary.eligible_365} pessoas com janela completa</small></article>
          <article className="kpi-card"><div><span className="kpi-icon">R$</span><p>Receita da coorte</p></div>
            <strong>{money.format(Number(summary.lifetime_net))}</strong><small>{summary.cohort_people} pessoas observadas</small></article>
        </section>
        <section className="dashboard-card report-card">
          <header className="card-header"><div><p className="panel-label">Marco: primeira compra aprovada</p>
            <h2>Coortes mensais</h2></div><span className="result-count">{monthsResult.rows.length} mês(es)</span></header>
          {monthsResult.rows.length?<div className="table-scroll"><table className="sales-table report-table">
            <thead><tr><th>Coorte</th><th>Pessoas</th><th>Receita líquida acumulada</th><th>Média acumulada por pessoa</th></tr></thead>
            <tbody>{monthsResult.rows.map(row=><tr key={row.cohort_month}>
              <td><strong>{month.format(new Date(`${row.cohort_month}T12:00:00Z`))}</strong></td>
              <td>{row.people}</td><td className="money-cell">{money.format(Number(row.lifetime_net))}</td>
              <td className="money-cell">{money.format(Number(row.average_lifetime_net))}</td>
            </tr>)}</tbody>
          </table></div>:<div className="chart-empty"><strong>Sem coortes elegíveis</strong>
            <p>As coortes aparecerão após uma primeira compra aprovada no período escolhido.</p></div>}
        </section>
        <div className="method-note"><strong>Leitura conservadora</strong><p>As janelas de 30, 90 e 365 dias excluem pessoas que ainda não completaram o período. Reembolsos e chargebacks reduzem o LTV líquido sem apagar a compra original.</p></div>
      </div>
    </section>
  </main>;
}
