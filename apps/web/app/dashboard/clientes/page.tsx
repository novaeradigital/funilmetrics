import { redirect } from "next/navigation";
import Link from "next/link";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type CustomerProps = {
  searchParams: Promise<{ period?: string }>;
};

const periods = {
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  "365d": { label: "1 ano", days: 365 },
  all: { label: "Tudo", days: null },
} as const;

type CustomerRow = {
  id: string;
  display_name: string | null;
  identifier: string | null;
  approved_orders: number;
  net_revenue: string;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  products: string[];
};

type CustomerSummary = {
  identified_people: number;
  buyers: number;
  repeat_buyers: number;
  net_revenue: string;
};

function maskIdentifier(value: string | null) {
  if (!value) return "Identificador indisponível";
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${(name ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : "Identificador protegido";
}

export default async function CustomersPage({ searchParams }: CustomerProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "90d";
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

  const [summaryResult, customersResult] = await Promise.all([
    database.pool.query<CustomerSummary>(
      `with ${accessCte},
       buyer_orders as (
         select orders.person_id,
                count(distinct orders.id) filter (where orders.status = 'approved') as approved_orders
           from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.person_id is not null
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
          group by orders.person_id
       ),
       financial as (
         select orders.person_id, coalesce(sum(event.financial_effect), 0) as net_revenue
           from public.normalized_payment_events event
           join public.commerce_orders orders on orders.id = event.order_id
          where event.data_scope = 'production'
            and orders.person_id is not null
            and event.project_id in (select id from accessible_projects)
            and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))
          group by orders.person_id
       )
       select count(distinct person.id)::int as identified_people,
              count(*) filter (where coalesce(buyer.approved_orders, 0) > 0)::int as buyers,
              count(*) filter (where coalesce(buyer.approved_orders, 0) > 1)::int as repeat_buyers,
              coalesce(sum(financial.net_revenue), 0)::text as net_revenue
         from public.people person
         left join buyer_orders buyer on buyer.person_id = person.id
         left join financial on financial.person_id = person.id
        where person.data_scope = 'production'
          and person.project_id in (select id from accessible_projects)`,
      [authData.user.id, period.days,project.id],
    ),
    database.pool.query<CustomerRow>(
      `with ${accessCte},
       selected_orders as (
         select orders.*
           from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.person_id is not null
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       ),
       financial as (
         select orders.person_id, coalesce(sum(event.financial_effect), 0) as net_revenue
           from public.normalized_payment_events event
           join selected_orders orders on orders.id = event.order_id
          group by orders.person_id
       ),
       product_names as (
         select orders.person_id,
                array_agg(distinct product.name order by product.name) as products
           from selected_orders orders
           join public.commerce_order_items item on item.order_id = orders.id
           join public.commerce_products product on product.id = item.product_id
          where orders.status = 'approved'
          group by orders.person_id
       )
       select person.id,
              person.display_name,
              identifier.normalized_value as identifier,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders,
              coalesce(financial.net_revenue, 0)::text as net_revenue,
              min(orders.occurred_at)
                filter (where orders.status = 'approved')::text as first_purchase_at,
              max(orders.occurred_at)
                filter (where orders.status = 'approved')::text as last_purchase_at,
              coalesce(products.products, '{}') as products
         from public.people person
         left join selected_orders orders on orders.person_id = person.id
         left join financial on financial.person_id = person.id
         left join product_names products on products.person_id = person.id
         left join lateral (
           select candidate.normalized_value
             from public.person_identifiers candidate
            where candidate.person_id = person.id
              and candidate.type in ('email','phone')
            order by case when candidate.type = 'email' then 0 else 1 end,
                     candidate.created_at
            limit 1
         ) identifier on true
        where person.data_scope = 'production'
          and person.project_id in (select id from accessible_projects)
        group by person.id, identifier.normalized_value, financial.net_revenue, products.products
        order by last_purchase_at desc nulls last, person.created_at desc
        limit 100`,
      [authData.user.id, period.days,project.id],
    ),
  ]);

  const summary = summaryResult.rows[0] ?? {
    identified_people: 0,
    buyers: 0,
    repeat_buyers: 0,
    net_revenue: "0",
  };
  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: project?.currency ?? "BRL",
  });
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: project?.timezone ?? "America/Sao_Paulo",
  });

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/clientes" footerLabel="Identidade protegida" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/clientes" statusLabel="Produção">
          <nav aria-label="Período dos clientes" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => <a className={key === periodKey ? "period-active" : undefined} href={`/dashboard/clientes?period=${key}`} key={key}>{option.label}</a>)}
          </nav>
        </DashboardTopbar>
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Identidade e histórico</p><h1>Clientes</h1><p className="dashboard-context">Acompanhe pessoas e compras sem dividir sua história por campanha ou produto.</p></div>
          </header>

          <section className="quality-summary">
            <article className="kpi-card"><div><span className="kpi-icon">♙</span><p>Pessoas identificadas</p></div><strong>{summary.identified_people}</strong><small>Escopo de produção</small></article>
            <article className="kpi-card kpi-primary"><div><span className="kpi-icon">✓</span><p>Compradores</p></div><strong>{summary.buyers}</strong><small>Com pedido aprovado no período</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">↻</span><p>Compradores recorrentes</p></div><strong>{summary.repeat_buyers}</strong><small>Mais de um pedido aprovado</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">R$</span><p>Receita líquida</p></div><strong>{money.format(Number(summary.net_revenue))}</strong><small>Efeito financeiro acumulado</small></article>
          </section>

          <section className="dashboard-card customers-card">
            <header className="card-header"><div><p className="panel-label">Jornada consolidada</p><h2>Pessoas recentes</h2></div><span className="result-count">{customersResult.rows.length} exibidas</span></header>
            {customersResult.rows.length ? (
              <div className="customer-list">
                {customersResult.rows.map((customer) => (
                  <Link href={`/dashboard/clientes/${customer.id}`} key={customer.id}>
                    <span className="customer-avatar">{(customer.display_name ?? "C").slice(0, 1).toUpperCase()}</span>
                    <p><strong>{customer.display_name ?? "Cliente sem nome"}</strong><small>{maskIdentifier(customer.identifier)}</small></p>
                    <div className="customer-products">{customer.products.slice(0, 3).map((product) => <span key={product}>{product}</span>)}</div>
                    <div className="customer-metric"><strong>{customer.approved_orders}</strong><small>compra(s)</small></div>
                    <div className="customer-metric"><strong>{money.format(Number(customer.net_revenue))}</strong><small>receita líquida</small></div>
                    <div className="customer-date"><strong>{customer.last_purchase_at ? date.format(new Date(customer.last_purchase_at)) : "Sem compra"}</strong><small>{customer.first_purchase_at ? "última compra" : "pessoa identificada"}</small></div>
                    <span className="customer-arrow">→</span>
                  </Link>
                ))}
              </div>
            ) : <div className="chart-empty"><strong>Nenhuma pessoa encontrada</strong><p>As identidades de produção aparecerão aqui após a normalização.</p></div>}
          </section>
          <p className="metric-footnote">Identificadores são mascarados na listagem · receita líquida segue regra financeira v1 · uma pessoa pode atravessar vários produtos e funis.</p>
        </div>
      </section>
    </main>
  );
}
