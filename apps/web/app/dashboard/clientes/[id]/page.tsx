import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";

export const dynamic = "force-dynamic";

type DetailProps = {
  params: Promise<{ id: string }>;
};

type PersonDetail = {
  id: string;
  display_name: string | null;
  created_at: string;
  identifiers: string[];
  approved_orders: number;
  net_revenue: string;
};

type TimelineRow = {
  id: string;
  type: string;
  external_event_name: string;
  occurred_at: string | null;
  financial_effect: string;
  order_status: string;
  products: string[];
  utm_source: string | null;
  utm_campaign: string | null;
  src: string | null;
};

type PurchaseStep = {
  id: string;
  occurred_at: string | null;
  paid_amount: string | null;
  products: string[];
};

const eventLabels: Record<string, string> = {
  checkout_abandoned: "Carrinho abandonado",
  payment_pending: "Pagamento solicitado",
  payment_approved: "Compra aprovada",
  payment_request_expired: "Solicitação expirada",
  payment_request_cancelled: "Solicitação cancelada",
  refund_requested: "Reembolso solicitado",
  payment_refunded: "Pagamento reembolsado",
  payment_chargeback: "Chargeback",
};

function protectedIdentifier(value: string) {
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${(name ?? "").slice(0, 2)}•••@${domain ?? ""}`;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : "Identificador protegido";
}

export default async function CustomerDetailPage({ params }: DetailProps) {
  const { id } = await params;
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
     where project.id=$3 and (not exists (
             select 1 from public.project_memberships restricted
              where restricted.membership_id = membership.id
           )
        or exists (
             select 1 from public.project_memberships allowed
              where allowed.membership_id = membership.id
                and allowed.project_id = project.id
           ))
  )`;

  const [personResult, timelineResult, purchasesResult] = await Promise.all([
    database.pool.query<PersonDetail>(
      `with ${accessCte},
       financial as (
         select orders.person_id, coalesce(sum(event.financial_effect), 0) as net_revenue
           from public.normalized_payment_events event
           join public.commerce_orders orders on orders.id = event.order_id
          where event.data_scope = 'production'
          group by orders.person_id
       )
       select person.id,
              person.display_name,
              person.created_at::text,
              coalesce(array_agg(distinct identifier.normalized_value)
                filter (where identifier.normalized_value is not null), '{}') as identifiers,
              count(distinct orders.id)
                filter (where orders.status = 'approved')::int as approved_orders,
              coalesce(financial.net_revenue, 0)::text as net_revenue
         from public.people person
         left join public.person_identifiers identifier on identifier.person_id = person.id
         left join public.commerce_orders orders on orders.person_id = person.id
         left join financial on financial.person_id = person.id
        where person.id = $2
          and person.data_scope = 'production'
          and person.project_id in (select id from accessible_projects)
        group by person.id, financial.net_revenue`,
      [authData.user.id, id,project.id],
    ),
    database.pool.query<TimelineRow>(
      `with ${accessCte},
       latest_attribution as (
         select distinct on (attribution.order_id)
                attribution.order_id, attribution.utm_source,
                attribution.utm_campaign, attribution.src
           from public.order_attributions attribution
          order by attribution.order_id, attribution.created_at desc
       )
       select event.id,
              event.type::text,
              event.external_event_name,
              event.occurred_at::text,
              event.financial_effect::text,
              orders.status::text as order_status,
              coalesce(array_agg(distinct product.name)
                filter (where product.name is not null), '{}') as products,
              attribution.utm_source,
              attribution.utm_campaign,
              attribution.src
         from public.normalized_payment_events event
         join public.commerce_orders orders on orders.id = event.order_id
         left join public.commerce_order_items item on item.order_id = orders.id
         left join public.commerce_products product on product.id = item.product_id
         left join latest_attribution attribution on attribution.order_id = orders.id
        where orders.person_id = $2
          and event.data_scope = 'production'
          and event.project_id in (select id from accessible_projects)
        group by event.id, orders.status, attribution.utm_source,
                 attribution.utm_campaign, attribution.src
        order by event.occurred_at desc nulls last, event.created_at desc`,
      [authData.user.id, id,project.id],
    ),
    database.pool.query<PurchaseStep>(
      `with ${accessCte}
       select orders.id,
              orders.occurred_at::text,
              orders.paid_amount::text,
              coalesce(array_agg(distinct product.name)
                filter (where product.name is not null), '{}') as products
         from public.commerce_orders orders
         left join public.commerce_order_items item on item.order_id = orders.id
         left join public.commerce_products product on product.id = item.product_id
        where orders.person_id = $2
          and orders.status = 'approved'
          and orders.data_scope = 'production'
          and orders.project_id in (select id from accessible_projects)
        group by orders.id
        order by orders.occurred_at asc nulls last`,
      [authData.user.id, id,project.id],
    ),
  ]);

  const person = personResult.rows[0];
  if (!person) notFound();
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

  return (
    <main className="journey-detail-shell">
      <header className="journey-detail-header">
        <div>
          <Link className="back-link" href="/dashboard/clientes">← Voltar para clientes</Link>
          <p className="eyebrow">Jornada individual</p>
          <h1>{person.display_name ?? "Cliente sem nome"}</h1>
          <div className="protected-identifiers">
            {person.identifiers.map((identifier) => <span key={identifier}>{protectedIdentifier(identifier)}</span>)}
          </div>
        </div>
        <div className="journey-summary-card">
          <span>Receita líquida</span><strong>{money.format(Number(person.net_revenue))}</strong>
          <small>{person.approved_orders} pedido(s) aprovado(s)</small>
        </div>
      </header>

      <section className="journey-grid">
        <article className="dashboard-card">
          <header className="card-header"><div><p className="panel-label">Linha do tempo</p><h2>Eventos comerciais</h2></div></header>
          {timelineResult.rows.length ? (
            <div className="journey-timeline">
              {timelineResult.rows.map((event) => {
                const effect = Number(event.financial_effect);
                return (
                  <div key={event.id}>
                    <span className={`timeline-dot event-${event.type}`} />
                    <div className="timeline-content">
                      <div><strong>{eventLabels[event.type] ?? event.type}</strong><time>{event.occurred_at ? date.format(new Date(event.occurred_at)) : "Data indisponível"}</time></div>
                      <small>{event.external_event_name}</small>
                      <div className="timeline-products">{event.products.map((product) => <span key={product}>{product}</span>)}</div>
                      <p>Origem: {event.utm_source ?? event.src ?? "não informada"} · {event.utm_campaign ?? "sem campanha UTM"}</p>
                    </div>
                    <strong className={effect < 0 ? "negative-effect" : effect > 0 ? "positive-effect" : ""}>
                      {effect === 0 ? "Sem efeito" : money.format(effect)}
                    </strong>
                  </div>
                );
              })}
            </div>
          ) : <div className="compact-empty">Nenhum evento comercial disponível.</div>}
        </article>

        <aside className="journey-side">
          <article className="dashboard-card">
            <header className="card-header"><div><p className="panel-label">Evolução de compras</p><h2>Pedidos aprovados</h2></div></header>
            {purchasesResult.rows.length ? (
              <div className="purchase-path">
                {purchasesResult.rows.map((purchase, index) => (
                  <div key={purchase.id}>
                    <span>{index + 1}</span>
                    <p><strong>{purchase.products.join(" + ") || "Produto não identificado"}</strong><small>{purchase.occurred_at ? date.format(new Date(purchase.occurred_at)) : "Data indisponível"}</small></p>
                    <strong>{purchase.paid_amount ? money.format(Number(purchase.paid_amount)) : "—"}</strong>
                  </div>
                ))}
              </div>
            ) : <div className="compact-empty">Nenhum pedido aprovado.</div>}
            {purchasesResult.rows.length > 1 ? (
              <div className="ascension-note"><strong>Recompra observada</strong><p>Existem pedidos aprovados distintos. A classificação como ascensão dependerá da hierarquia de produtos.</p></div>
            ) : null}
          </article>
          <article className="method-note"><strong>Privacidade e interpretação</strong><p>Identificadores ficam mascarados. Itens do mesmo pedido não são tratados como ascensão; a linha do tempo preserva reembolsos e chargebacks.</p></article>
        </aside>
      </section>
    </main>
  );
}
