import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ period?: string; dimension?: string }>;
};

const periods = {
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  all: { label: "Tudo", days: null },
} as const;

const dimensions = {
  source: "Fonte",
  campaign: "Campanha",
  medium: "Mídia",
} as const;

type AttributionRow = {
  dimension_value: string;
  orders: number;
  approved_orders: number;
  gross_revenue: string;
  net_revenue: string;
  buyers: number;
};

type Coverage = {
  attributed_orders: number;
  total_orders: number;
  with_source: number;
  with_campaign: number;
};

export default async function AttributionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "30d";
  const dimensionKey =
    params.dimension && params.dimension in dimensions
      ? (params.dimension as keyof typeof dimensions)
      : "source";
  const period = periods[periodKey];
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const {project}=await getActiveProject(authData.user.id);
  if(!project)redirect("/dashboard/projetos");
  const database = getDatabase();
  const accessCte = `accessible_projects as (
    select project.id
      from public.projects project
      join public.users app_user on app_user.auth_user_id = $1
      join public.memberships membership
        on membership.organization_id = project.organization_id
       and membership.user_id = app_user.id
     where project.id = $3
       and (not exists (
             select 1 from public.project_memberships restricted
              where restricted.membership_id = membership.id
           )
        or exists (
             select 1 from public.project_memberships allowed
              where allowed.membership_id = membership.id
                and allowed.project_id = project.id
           ))
  )`;
  const dimensionSql = {
    source: "coalesce(nullif(attribution.utm_source, ''), nullif(attribution.src, ''), 'Não informada')",
    campaign: "coalesce(nullif(attribution.utm_campaign, ''), 'Não informada')",
    medium: "coalesce(nullif(attribution.utm_medium, ''), 'Não informada')",
  }[dimensionKey];

  const [coverageResult, attributionResult] = await Promise.all([
    database.pool.query<Coverage>(
      `with ${accessCte},
       selected_orders as (
         select orders.id from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       ),
       latest as (
         select distinct on (attribution.order_id)
                attribution.order_id, attribution.utm_source,
                attribution.utm_campaign, attribution.src
           from public.order_attributions attribution
           join selected_orders orders on orders.id = attribution.order_id
          order by attribution.order_id, attribution.created_at desc
       )
       select (select count(*) from latest)::int as attributed_orders,
              (select count(*) from selected_orders)::int as total_orders,
              count(*) filter (
                where coalesce(nullif(latest.utm_source, ''), nullif(latest.src, '')) is not null
              )::int as with_source,
              count(*) filter (where nullif(latest.utm_campaign, '') is not null)::int as with_campaign
         from latest`,
      [authData.user.id, period.days,project.id],
    ),
    database.pool.query<AttributionRow>(
      `with ${accessCte},
       selected_orders as (
         select orders.* from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       ),
       latest_attribution as (
         select distinct on (attribution.order_id) attribution.*
           from public.order_attributions attribution
           join selected_orders orders on orders.id = attribution.order_id
          order by attribution.order_id, attribution.created_at desc
       ),
       order_financial as (
         select orders.id as order_id,
                coalesce(sum(event.financial_effect)
                  filter (where event.financial_effect > 0), 0) as gross_revenue,
                coalesce(sum(event.financial_effect), 0) as net_revenue
           from selected_orders orders
           left join public.normalized_payment_events event on event.order_id = orders.id
          group by orders.id
       )
       select ${dimensionSql} as dimension_value,
              count(distinct orders.id)::int as orders,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders,
              coalesce(sum(financial.gross_revenue), 0)::text as gross_revenue,
              coalesce(sum(financial.net_revenue), 0)::text as net_revenue,
              count(distinct orders.person_id)
                filter (where orders.person_id is not null)::int as buyers
         from selected_orders orders
         left join latest_attribution attribution on attribution.order_id = orders.id
         left join order_financial financial on financial.order_id = orders.id
        group by ${dimensionSql}
        order by net_revenue desc, approved_orders desc
        limit 50`,
      [authData.user.id, period.days,project.id],
    ),
  ]);

  const coverage = coverageResult.rows[0] ?? {
    attributed_orders: 0,
    total_orders: 0,
    with_source: 0,
    with_campaign: 0,
  };
  const sourceCoverage =
    coverage.total_orders > 0 ? (coverage.with_source / coverage.total_orders) * 100 : 0;
  const campaignCoverage =
    coverage.total_orders > 0 ? (coverage.with_campaign / coverage.total_orders) * 100 : 0;
  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: project?.currency ?? "BRL",
  });
  const maximumRevenue = Math.max(
    ...attributionResult.rows.map((row) => Number(row.net_revenue)),
    1,
  );
  const queryFor = (nextPeriod: string, nextDimension: string) =>
    `/dashboard/atribuicao?period=${nextPeriod}&dimension=${nextDimension}`;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/atribuicao" footerLabel="UTMs preservadas" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/atribuicao" statusLabel="Lastlink">
          <nav aria-label="Período da atribuição" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => <a className={key === periodKey ? "period-active" : undefined} href={queryFor(key, dimensionKey)} key={key}>{option.label}</a>)}
          </nav>
        </DashboardTopbar>
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Origem registrada</p><h1>Atribuição</h1><p className="dashboard-context">Compare UTMs recebidas nos pedidos sem confundir origem informada com atribuição multitoque.</p></div>
          </header>

          <section className="attribution-coverage">
            <article className="kpi-card kpi-primary"><div><span className="kpi-icon">⌁</span><p>Pedidos com atribuição</p></div><strong>{coverage.attributed_orders}</strong><small>de {coverage.total_orders} pedidos no período</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">S</span><p>Cobertura de fonte</p></div><strong>{sourceCoverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><small>utm_source ou src informado</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">C</span><p>Cobertura de campanha</p></div><strong>{campaignCoverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><small>utm_campaign informado</small></article>
          </section>

          <nav className="dimension-tabs" aria-label="Dimensão da atribuição">
            {Object.entries(dimensions).map(([key, label]) => <a className={key === dimensionKey ? "active" : undefined} href={queryFor(periodKey, key)} key={key}>{label}</a>)}
          </nav>

          <section className="attribution-layout">
            <article className="dashboard-card attribution-chart-card">
              <header className="card-header"><div><p className="panel-label">Comparativo</p><h2>Receita líquida por {dimensions[dimensionKey].toLowerCase()}</h2></div></header>
              {attributionResult.rows.length ? (
                <div className="horizontal-bars">
                  {attributionResult.rows.slice(0, 10).map((row) => (
                    <div key={row.dimension_value}>
                      <p><strong>{row.dimension_value}</strong><small>{row.approved_orders} aprovados</small></p>
                      <div><span style={{ width: `${Math.max((Number(row.net_revenue) / maximumRevenue) * 100, 2)}%` }} /></div>
                      <strong>{money.format(Number(row.net_revenue))}</strong>
                    </div>
                  ))}
                </div>
              ) : <div className="chart-empty"><strong>Nenhuma atribuição encontrada</strong><p>As UTMs aparecerão após o recebimento de pedidos atribuídos.</p></div>}
            </article>

            <article className="dashboard-card attribution-table-card">
              <header className="card-header"><div><p className="panel-label">Detalhamento</p><h2>Resultados observados</h2></div></header>
              <div className="table-scroll">
                <table className="sales-table attribution-table">
                  <thead><tr><th>{dimensions[dimensionKey]}</th><th>Pedidos</th><th>Aprovados</th><th>Pessoas</th><th>Receita bruta</th><th>Receita líquida</th></tr></thead>
                  <tbody>{attributionResult.rows.map((row) => (
                    <tr key={row.dimension_value}>
                      <td><strong>{row.dimension_value}</strong></td><td>{row.orders}</td><td>{row.approved_orders}</td><td>{row.buyers}</td>
                      <td className="money-cell">{money.format(Number(row.gross_revenue))}</td><td className="money-cell">{money.format(Number(row.net_revenue))}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </article>
          </section>
          <div className="method-note"><strong>Limite metodológico</strong><p>Esta tela agrupa a atribuição mais recente recebida para cada pedido. Ela não redistribui crédito, não reconstrói touchpoints anteriores e não substitui os futuros modelos de primeiro toque, último toque ou assistência.</p></div>
        </div>
      </section>
    </main>
  );
}
