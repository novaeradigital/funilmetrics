import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type SalesProps = {
  searchParams: Promise<{ period?: string; status?: string }>;
};

const periods = {
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  all: { label: "Tudo", days: null },
} as const;

const statuses = {
  all: "Todos",
  approved: "Aprovados",
  pending: "Pendentes",
  refunded: "Reembolsados",
  chargeback: "Chargebacks",
  cancelled: "Cancelados",
  expired: "Expirados",
  refund_requested: "Reembolso solicitado",
  abandoned: "Abandonados",
} as const;

const statusLabels: Record<string, string> = {
  approved: "Aprovado",
  pending: "Pendente",
  refunded: "Reembolsado",
  chargeback: "Chargeback",
  cancelled: "Cancelado",
  expired: "Expirado",
  refund_requested: "Reembolso solicitado",
  abandoned: "Abandonado",
};

type SaleRow = {
  id: string;
  status: string;
  currency: string;
  paid_amount: string | null;
  occurred_at: string | null;
  customer_name: string | null;
  payment_method: string | null;
  installments: number | null;
  products: string[];
  utm_source: string | null;
  utm_campaign: string | null;
  src: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  orders_count: number;
  approved_orders: number;
};

type Summary = {
  total_orders: number;
  approved_orders: number;
  pending_orders: number;
  reversed_orders: number;
};

export default async function SalesPage({ searchParams }: SalesProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "30d";
  const statusKey =
    params.status && params.status in statuses
      ? (params.status as keyof typeof statuses)
      : "all";
  const period = periods[periodKey];
  const status = statusKey === "all" ? null : statusKey;

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
     where project.id = $4
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

  const [summaryResult, productsResult, salesResult] = await Promise.all([
    database.pool.query<Summary>(
      `with ${accessCte}
       select count(*)::int as total_orders,
              count(*) filter (where orders.status = 'approved')::int as approved_orders,
              count(*) filter (where orders.status = 'pending')::int as pending_orders,
              count(*) filter (where orders.status in ('refunded','chargeback'))::int as reversed_orders
         from public.commerce_orders orders
        where orders.data_scope = 'production'
          and orders.project_id in (select id from accessible_projects)
          and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
          and ($3::text is null or orders.status::text = $3)`,
      [authData.user.id, period.days, status, project.id],
    ),
    database.pool.query<ProductRow>(
      `with ${accessCte}
       select product.id,
              product.name,
              count(distinct orders.id)::int as orders_count,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders
         from public.commerce_products product
         join public.commerce_order_items item on item.product_id = product.id
         join public.commerce_orders orders on orders.id = item.order_id
        where product.data_scope = 'production'
          and orders.data_scope = 'production'
          and orders.project_id in (select id from accessible_projects)
          and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
          and ($3::text is null or orders.status::text = $3)
        group by product.id, product.name
        order by approved_orders desc, orders_count desc, product.name
        limit 20`,
      [authData.user.id, period.days, status, project.id],
    ),
    database.pool.query<SaleRow>(
      `with ${accessCte},
       latest_attribution as (
         select distinct on (attribution.order_id)
                attribution.order_id,
                attribution.utm_source,
                attribution.utm_campaign,
                attribution.src
           from public.order_attributions attribution
          order by attribution.order_id, attribution.created_at desc
       )
       select orders.id,
              orders.status::text,
              orders.currency,
              orders.paid_amount::text,
              orders.occurred_at::text,
              person.display_name as customer_name,
              payment.method as payment_method,
              payment.installments,
              coalesce(array_agg(distinct product.name)
                filter (where product.name is not null), '{}') as products,
              attribution.utm_source,
              attribution.utm_campaign,
              attribution.src
         from public.commerce_orders orders
         left join public.people person on person.id = orders.person_id
         left join public.payments payment on payment.order_id = orders.id
         left join public.commerce_order_items item on item.order_id = orders.id
         left join public.commerce_products product on product.id = item.product_id
         left join latest_attribution attribution on attribution.order_id = orders.id
        where orders.data_scope = 'production'
          and orders.project_id in (select id from accessible_projects)
          and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
          and ($3::text is null or orders.status::text = $3)
        group by orders.id, person.display_name, payment.method, payment.installments,
                 attribution.utm_source, attribution.utm_campaign, attribution.src
        order by orders.occurred_at desc nulls last, orders.created_at desc
        limit 100`,
      [authData.user.id, period.days, status, project.id],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    total_orders: 0,
    approved_orders: 0,
    pending_orders: 0,
    reversed_orders: 0,
  };
  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: project?.currency ?? "BRL",
  });
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: project?.timezone ?? "America/Sao_Paulo",
  });
  const queryFor = (nextPeriod: string, nextStatus: string) =>
    `/dashboard/vendas?period=${nextPeriod}&status=${nextStatus}`;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/vendas" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/vendas" statusLabel="Produção">
          <nav aria-label="Período" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => (
              <a className={key === periodKey ? "period-active" : undefined}
                 href={queryFor(key, statusKey)} key={key}>{option.label}</a>
            ))}
          </nav>
        </DashboardTopbar>

        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Pedidos e produtos</p>
              <h1>Vendas</h1>
              <p className="dashboard-context">Consulte pedidos, produtos presentes e origem registrada pela Lastlink.</p>
            </div>
          </header>

          <section className="sales-summary">
            <article><span>Pedidos no período</span><strong>{summary.total_orders}</strong></article>
            <article><span>Aprovados</span><strong>{summary.approved_orders}</strong></article>
            <article><span>Pendentes</span><strong>{summary.pending_orders}</strong></article>
            <article><span>Revertidos</span><strong>{summary.reversed_orders}</strong></article>
          </section>

          <nav className="status-filter" aria-label="Status dos pedidos">
            {Object.entries(statuses).map(([key, label]) => (
              <a className={key === statusKey ? "active" : undefined}
                 href={queryFor(periodKey, key)} key={key}>{label}</a>
            ))}
          </nav>

          <section className="sales-layout">
            <article className="dashboard-card products-card">
              <header className="card-header">
                <div><p className="panel-label">Catálogo detectado</p><h2>Produtos nos pedidos</h2></div>
              </header>
              {productsResult.rows.length ? (
                <div className="product-ranking">
                  {productsResult.rows.map((product) => (
                    <div key={product.id}>
                      <span title={product.name}>{product.name}</span>
                      <strong>{product.approved_orders}<small> aprov.</small></strong>
                      <em>{product.orders_count} pedido(s)</em>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="compact-empty">Nenhum produto encontrado neste recorte.</div>
              )}
              <p className="allocation-warning">Valores não são distribuídos por produto enquanto a Lastlink não fornecer preço por item ou uma regra de alocação for aprovada.</p>
            </article>

            <article className="dashboard-card orders-card">
              <header className="card-header">
                <div><p className="panel-label">Movimentação</p><h2>Pedidos recentes</h2></div>
                <span className="result-count">{salesResult.rows.length} exibidos</span>
              </header>
              {salesResult.rows.length ? (
                <div className="table-scroll">
                  <table className="sales-table">
                    <thead><tr><th>Cliente e data</th><th>Produtos</th><th>Origem</th><th>Pagamento</th><th>Status</th><th>Valor</th></tr></thead>
                    <tbody>
                      {salesResult.rows.map((sale) => (
                        <tr key={sale.id}>
                          <td><strong>{sale.customer_name ?? "Cliente não identificado"}</strong><small>{sale.occurred_at ? date.format(new Date(sale.occurred_at)) : "Data indisponível"}</small></td>
                          <td><div className="table-tags">{sale.products.map((product) => <span key={product}>{product}</span>)}</div></td>
                          <td><strong>{sale.utm_source ?? sale.src ?? "Não informada"}</strong><small>{sale.utm_campaign ?? "Sem campanha UTM"}</small></td>
                          <td><strong>{sale.payment_method ?? "Não informado"}</strong><small>{sale.installments ? `${sale.installments}x` : "Parcelamento indisponível"}</small></td>
                          <td><span className={`order-status status-${sale.status}`}>{statusLabels[sale.status] ?? sale.status}</span></td>
                          <td className="money-cell">{sale.paid_amount === null ? "—" : money.format(Number(sale.paid_amount))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="chart-empty"><strong>Nenhum pedido encontrado</strong><p>Altere o período ou o status para ampliar a busca.</p></div>
              )}
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}
