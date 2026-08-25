import { redirect } from "next/navigation";
import Link from "next/link";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type FunnelProps = {
  searchParams: Promise<{ period?: string }>;
};

const periods = {
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  "90d": { label: "90 dias", days: 90 },
  all: { label: "Tudo", days: null },
} as const;

type EventCounts = {
  checkout_abandoned: number;
  payment_pending: number;
  payment_approved: number;
  payment_request_expired: number;
  payment_request_cancelled: number;
  refund_requested: number;
  payment_refunded: number;
  payment_chargeback: number;
};

type UtmRow = {
  source: string;
  campaign: string;
  orders: number;
  approved: number;
};

const stages = [
  {
    key: "checkout_abandoned" as const,
    title: "Carrinho abandonado",
    description: "Abandoned_Cart",
    tone: "neutral",
  },
  {
    key: "payment_pending" as const,
    title: "Pagamento solicitado",
    description: "Purchase_Request_Confirmed",
    tone: "attention",
  },
  {
    key: "payment_approved" as const,
    title: "Compra aprovada",
    description: "Purchase_Order_Confirmed",
    tone: "success",
  },
];

export default async function FunnelPage({ searchParams }: FunnelProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "30d";
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

  const [countsResult, utmResult] = await Promise.all([
    database.pool.query<EventCounts>(
      `with ${accessCte}
       select count(distinct event.order_id)
                filter (where event.type = 'checkout_abandoned')::int as checkout_abandoned,
              count(distinct event.order_id)
                filter (where event.type = 'payment_pending')::int as payment_pending,
              count(distinct event.order_id)
                filter (where event.type = 'payment_approved')::int as payment_approved,
              count(distinct event.order_id)
                filter (where event.type = 'payment_request_expired')::int as payment_request_expired,
              count(distinct event.order_id)
                filter (where event.type = 'payment_request_cancelled')::int as payment_request_cancelled,
              count(distinct event.order_id)
                filter (where event.type = 'refund_requested')::int as refund_requested,
              count(distinct event.order_id)
                filter (where event.type = 'payment_refunded')::int as payment_refunded,
              count(distinct event.order_id)
                filter (where event.type = 'payment_chargeback')::int as payment_chargeback
         from public.normalized_payment_events event
        where event.data_scope = 'production'
          and event.project_id in (select id from accessible_projects)
          and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))`,
      [authData.user.id, period.days, project.id],
    ),
    database.pool.query<UtmRow>(
      `with ${accessCte},
       attributed_orders as (
         select attribution.order_id,
                coalesce(nullif(attribution.utm_source, ''), nullif(attribution.src, ''), 'Não informada') as source,
                coalesce(nullif(attribution.utm_campaign, ''), 'Sem campanha UTM') as campaign,
                row_number() over (
                  partition by attribution.order_id order by attribution.created_at desc
                ) as position
           from public.order_attributions attribution
           join public.commerce_orders orders on orders.id = attribution.order_id
          where orders.data_scope = 'production'
            and orders.project_id in (select id from accessible_projects)
            and ($2::int is null or orders.occurred_at >= now() - ($2 * interval '1 day'))
       )
       select attributed.source,
              attributed.campaign,
              count(distinct attributed.order_id)::int as orders,
              count(distinct attributed.order_id)
                filter (where orders.status = 'approved')::int as approved
         from attributed_orders attributed
         join public.commerce_orders orders on orders.id = attributed.order_id
        where attributed.position = 1
        group by attributed.source, attributed.campaign
        order by approved desc, orders desc
        limit 12`,
      [authData.user.id, period.days, project.id],
    ),
  ]);

  const counts = countsResult.rows[0] ?? {
    checkout_abandoned: 0,
    payment_pending: 0,
    payment_approved: 0,
    payment_request_expired: 0,
    payment_request_cancelled: 0,
    refund_requested: 0,
    payment_refunded: 0,
    payment_chargeback: 0,
  };
  const stageMaximum = Math.max(...stages.map((stage) => counts[stage.key]), 1);
  const losses = [
    { label: "Solicitações expiradas", value: counts.payment_request_expired },
    { label: "Solicitações canceladas", value: counts.payment_request_cancelled },
    { label: "Reembolsos solicitados", value: counts.refund_requested },
    { label: "Pagamentos reembolsados", value: counts.payment_refunded },
    { label: "Chargebacks", value: counts.payment_chargeback },
  ];

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/funil" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/funil" statusLabel="Dados observados">
          <nav aria-label="Período do funil" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => (
              <a className={key === periodKey ? "period-active" : undefined}
                 href={`/dashboard/funil?period=${key}`} key={key}>{option.label}</a>
            ))}
          </nav>
          <Link className="icon-button" href="/dashboard/funis">Configurar</Link>
        </DashboardTopbar>

        <div className="dashboard-main funnel-dashboard">
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Comportamento de compra</p>
              <h1>Funil observado</h1>
              <p className="dashboard-context">Volumes distintos por evento confirmado da Lastlink, sem assumir transição entre sessões.</p>
            </div>
          </header>

          <section className="dashboard-card funnel-card funnel-canvas-card">
            <header className="card-header">
              <div><p className="panel-label">Mapa operacional</p><h2>Jornada observada</h2></div>
              <span className="result-count">Pedidos distintos · sem taxa inferida</span>
            </header>
            <div className="funnel-canvas" role="list" aria-label="Etapas observadas do funil">
              {stages.map((stage, index) => {
                const value = counts[stage.key];
                const relativeVolume = Math.round((value / stageMaximum) * 100);
                return (
                  <div className="funnel-canvas-step" key={stage.key} role="listitem">
                    {index > 0 ? <span className="funnel-connector" aria-hidden="true"><i /></span> : null}
                    <article className={`funnel-node funnel-${stage.tone}`}>
                      <header><span>{index + 1}</span><small>Etapa observada</small></header>
                      <p><strong>{stage.title}</strong><small>{stage.description}</small></p>
                      <div className="funnel-node-metric"><strong>{value}</strong><span>pedido(s)</span></div>
                      <div className="funnel-node-volume" title="Volume relativo apenas para comparação visual">
                        <i style={{ width: `${relativeVolume}%` }} />
                      </div>
                    </article>
                  </div>
                );
              })}
            </div>
            <details className="method-note funnel-method-note">
              <summary>Como interpretar estes dados</summary>
              <p>Os nós comparam volume, mas não representam uma taxa de conversão sequencial. A Lastlink pode enviar uma aprovação sem que o sistema tenha recebido antes o abandono ou a solicitação correspondente.</p>
            </details>
          </section>

          <section className="funnel-detail-grid">
            <article className="dashboard-card">
              <header className="card-header"><div><p className="panel-label">Saídas e reversões</p><h2>Eventos de perda</h2></div></header>
              <div className="loss-list">
                {losses.map((loss) => (
                  <div key={loss.label}><span>{loss.label}</span><strong>{loss.value}</strong></div>
                ))}
              </div>
            </article>

            <article className="dashboard-card source-card">
              <header className="card-header"><div><p className="panel-label">Atribuição recebida</p><h2>Origem dos pedidos</h2></div></header>
              {utmResult.rows.length ? (
                <div className="source-list">
                  {utmResult.rows.map((row) => (
                    <div key={`${row.source}-${row.campaign}`}>
                      <p><strong>{row.source}</strong><small>{row.campaign}</small></p>
                      <span>{row.orders} pedidos</span>
                      <strong>{row.approved} aprov.</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="compact-empty">Nenhuma origem UTM encontrada neste período.</div>
              )}
            </article>
          </section>

          <p className="metric-footnote">
            Fonte Lastlink · produção · contagem distinta por pedido e tipo de evento · UTMs preservadas conforme recebidas.
          </p>
        </div>
      </section>
    </main>
  );
}
