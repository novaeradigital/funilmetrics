import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import { classifyProduct } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ period?: string; product?: string }>;
};

const periods = {
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  all: { label: "Tudo", days: null },
} as const;

type ProductRow = {
  id: string;
  name: string;
  external_id: string;
  connection_name: string;
  configured_primary_name: string | null;
  orders: number;
  approved_orders: number;
  pending_orders: number;
  reversed_orders: number;
  abandoned_orders: number;
  buyers: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  journey_role:string|null;
  parent_product_id:string|null;
};

type ProductSummary = {
  products: number;
  orders_with_products: number;
  approved_orders: number;
  buyers: number;
};
type ProductOption={id:string;name:string};
type ProductDaily={day:string;orders:number;approved_orders:number;buyers:number};

export default async function ProductsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "30d";
  const period = periods[periodKey];
  const selectedProduct=/^[0-9a-f-]{36}$/i.test(params.product??"")
    ? params.product! : null;
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

  const [summaryResult, productsResult,productOptionsResult,dailyResult] = await Promise.all([
    database.pool.query<ProductSummary>(
      `with ${accessCte},
       selected_orders as (
         select orders.*
           from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       )
       select count(distinct product.id)::int as products,
              count(distinct orders.id)::int as orders_with_products,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders,
              count(distinct orders.person_id)
                filter (where orders.person_id is not null)::int as buyers
         from selected_orders orders
         join public.commerce_order_items item on item.order_id = orders.id
         join public.commerce_products product on product.id = item.product_id
        where ($3::uuid is null or product.id=$3)`,
      [authData.user.id, period.days,selectedProduct,project.id],
    ),
    database.pool.query<ProductRow>(
      `with ${accessCte},
       selected_orders as (
         select orders.*
           from public.commerce_orders orders
          where orders.data_scope = 'production'
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       )
       select product.id,
              product.name,
              product.external_id,
              connection.name as connection_name,
              connection.configuration->>'productName' as configured_primary_name,
              classification.role::text journey_role,
              classification.parent_product_id,
              count(distinct orders.id)::int as orders,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders,
              count(distinct orders.id)
                filter (where orders.status = 'pending')::int as pending_orders,
              count(distinct orders.id)
                filter (where orders.status in ('refunded','chargeback'))::int as reversed_orders,
              count(distinct orders.id)
                filter (where orders.status = 'abandoned')::int as abandoned_orders,
              count(distinct orders.person_id)
                filter (where orders.person_id is not null)::int as buyers,
              min(orders.occurred_at)::text as first_seen_at,
              max(orders.occurred_at)::text as last_seen_at
         from public.commerce_products product
         join public.connections connection on connection.id = product.connection_id
         left join public.commerce_order_items item on item.product_id = product.id
         left join selected_orders orders on orders.id = item.order_id
         left join public.product_classifications classification
           on classification.product_id=product.id and classification.effective_until is null
        where product.data_scope = 'production'
          and product.project_id in (select id from accessible_projects)
          and ($3::uuid is null or product.id=$3)
        group by product.id, connection.name, connection.configuration,
          classification.role,classification.parent_product_id
        order by approved_orders desc, orders desc, product.name
        limit 100`,
      [authData.user.id, period.days,selectedProduct,project.id],
    ),
    database.pool.query<ProductOption>(
      `with ${accessCte} select product.id,product.name from public.commerce_products product
       where product.data_scope='production' and product.project_id in(select id from accessible_projects)
       order by product.name`,[authData.user.id,null,null,project.id]),
    database.pool.query<ProductDaily>(
      `with ${accessCte}, selected as (
        select date_trunc('day',orders.occurred_at)::date::text day,orders.id,
          orders.status,orders.person_id
        from public.commerce_orders orders join public.commerce_order_items item on item.order_id=orders.id
        where orders.data_scope='production' and orders.project_id in(select id from accessible_projects)
          and ($2::int is null or orders.occurred_at>=now()-($2*interval '1 day'))
          and ($3::uuid is null or item.product_id=$3))
       select day,count(distinct id)::int orders,
        count(distinct id) filter(where status='approved')::int approved_orders,
        count(distinct person_id) filter(where person_id is not null)::int buyers
       from selected group by day order by day`,
      [authData.user.id,period.days,selectedProduct,project.id]),
  ]);

  const summary = summaryResult.rows[0] ?? {
    products: 0,
    orders_with_products: 0,
    approved_orders: 0,
    buyers: 0,
  };
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: project?.timezone ?? "America/Sao_Paulo",
  });
  const maxOrders = Math.max(...productsResult.rows.map((row) => row.orders), 1);

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/produtos" footerLabel="Catálogo sincronizado" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/produtos" statusLabel="Produção">
          <nav aria-label="Período dos produtos" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => <a className={key === periodKey ? "period-active" : undefined} href={`/dashboard/produtos?period=${key}${selectedProduct?`&product=${selectedProduct}`:""}`} key={key}>{option.label}</a>)}
          </nav>
        </DashboardTopbar>
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Catálogo comercial</p><h1>Produtos</h1><p className="dashboard-context">Compare presença nos pedidos sem duplicar receita entre produto principal e itens adicionais.</p></div>
          </header>
          <form className="filter-card" method="get">
            <input type="hidden" name="period" value={periodKey}/>
            <label>Produto
              <select name="product" defaultValue={selectedProduct??""}>
                <option value="">Todos os produtos</option>
                {productOptionsResult.rows.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <button type="submit">Aplicar filtro</button>
          </form>

          <section className="quality-summary">
            <article className="kpi-card"><div><span className="kpi-icon">□</span><p>Produtos detectados</p></div><strong>{summary.products}</strong><small>Catálogo de produção</small></article>
            <article className="kpi-card kpi-primary"><div><span className="kpi-icon">◇</span><p>Pedidos com produtos</p></div><strong>{summary.orders_with_products}</strong><small>Pedidos distintos</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">✓</span><p>Pedidos aprovados</p></div><strong>{summary.approved_orders}</strong><small>Qualquer produto presente</small></article>
            <article className="kpi-card"><div><span className="kpi-icon">♙</span><p>Pessoas</p></div><strong>{summary.buyers}</strong><small>Identificadas nos pedidos</small></article>
          </section>
          <section className="dashboard-card">
            <header><div><p className="panel-label">Série temporal</p><h2>Pedidos por dia</h2></div></header>
            {dailyResult.rows.length?<div className="table-shell"><table>
              <thead><tr><th>Dia</th><th>Pedidos</th><th>Aprovados</th><th>Pessoas</th></tr></thead>
              <tbody>{dailyResult.rows.map(point=><tr key={point.day}>
                <td>{date.format(new Date(`${point.day}T12:00:00Z`))}</td>
                <td>{point.orders}</td><td>{point.approved_orders}</td><td>{point.buyers}</td>
              </tr>)}</tbody>
            </table></div>:<div className="chart-empty"><strong>Sem dados no período</strong></div>}
          </section>

          <section className="products-grid">
            {productsResult.rows.map((product) => {
              const approvalRate = product.orders > 0
                ? (product.approved_orders / product.orders) * 100
                : 0;
              const isPrimary = product.configured_primary_name === product.name;
              return (
                <article className="dashboard-card product-analysis-card" key={product.id}>
                  <header>
                    <div><span className={isPrimary ? "product-role primary-role" : "product-role"}>{isPrimary ? "Produto principal confirmado" : "Item associado observado"}</span><h2>{product.name}</h2><small>{product.connection_name}</small></div>
                    <strong>{product.approved_orders}<small> aprov.</small></strong>
                  </header>
                  <div className="product-volume"><span style={{ width: `${Math.max((product.orders / maxOrders) * 100, 2)}%` }} /></div>
                  <div className="product-analysis-stats">
                    <span><strong>{product.orders}</strong> pedidos</span>
                    <span><strong>{approvalRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong> aprovados</span>
                    <span><strong>{product.pending_orders}</strong> pendentes</span>
                    <span><strong>{product.reversed_orders}</strong> revertidos</span>
                    <span><strong>{product.buyers}</strong> pessoas</span>
                  </div>
                  <footer>
                    <span>ID externo: {product.external_id}</span>
                    <span>{product.last_seen_at ? `Último pedido ${date.format(new Date(product.last_seen_at))}` : "Sem pedido no período"}</span>
                  </footer>
                  <form action={classifyProduct}>
                    <input type="hidden" name="product_id" value={product.id}/>
                    <select name="role" defaultValue={product.journey_role??(isPrimary?"primary":"unknown")}>
                      <option value="primary">Principal</option><option value="order_bump">Order bump</option>
                      <option value="upsell">Upsell</option><option value="downsell">Downsell</option>
                      <option value="subscription">Assinatura</option><option value="addon">Adicional</option>
                      <option value="unknown">Não classificado</option>
                    </select>
                    <select name="parent_product_id" defaultValue={product.parent_product_id??""}>
                      <option value="">Sem produto pai</option>
                      {productsResult.rows.filter(item=>item.id!==product.id).map(item=>
                        <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <input name="reason" placeholder="Motivo ou evidência da classificação"/>
                    <button type="submit">Salvar classificação</button>
                  </form>
                </article>
              );
            })}
          </section>
          {!productsResult.rows.length ? <div className="dashboard-card chart-empty"><strong>Nenhum produto encontrado</strong><p>Produtos de produção aparecerão após a normalização.</p></div> : null}
          <div className="method-note"><strong>Receita por produto ainda indisponível</strong><p>A Lastlink informa o valor do pedido, mas não o valor confiável de cada item. Por isso esta tela mede presença, pedidos e pessoas, sem repartir artificialmente a receita.</p></div>
        </div>
      </section>
    </main>
  );
}
