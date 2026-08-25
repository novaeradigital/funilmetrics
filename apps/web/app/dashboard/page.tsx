import { redirect } from "next/navigation";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardTopbar } from "./dashboard-topbar";
import Link from "next/link";
import { getDatabase } from "../../lib/database";
import { createClient } from "../../lib/supabase/server";
import {getActiveProject} from "../../lib/active-project";

export const dynamic = "force-dynamic";

type DashboardProps = {
  searchParams: Promise<{ period?: string }>;
};

type DailyMetric = {
  day: string;
  gross_revenue: string;
  net_revenue: string;
  approved_payments: number;
};
type MetaOverview={accounts:number;campaigns:number;ads:number;
  last_metric_date:string|null;active_runs:number;failed_connections:number};
type MetaSpend={currency:string;spend:string};

const periods = {
  "7d": { label: "7 dias", description: "Últimos 7 dias", days: 7 },
  "30d": { label: "30 dias", description: "Últimos 30 dias", days: 30 },
  "90d": { label: "90 dias", description: "Últimos 90 dias", days: 90 },
  all: { label: "Tudo", description: "Todo o histórico", days: null },
} as const;

function TrendChart({
  rows,
  money,
}: {
  rows: DailyMetric[];
  money: Intl.NumberFormat;
}) {
  if (rows.length === 0) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-icon" aria-hidden="true">↗</span>
        <strong>Ainda não há movimentação neste período</strong>
        <p>Os pagamentos de produção aparecerão aqui após a normalização.</p>
      </div>
    );
  }

  const values = rows.map((row) => Number(row.gross_revenue));
  const maximum = Math.max(...values, 1);

  return (
    <div className="chart-bars" aria-label="Receita bruta diária">
      {rows.map((row) => {
        const value = Number(row.gross_revenue);
        const date = new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${row.day}T12:00:00Z`));

        return (
          <div className="chart-column" key={row.day}>
            <div className="chart-tooltip">
              <strong>{money.format(value)}</strong>
              <span>{row.approved_payments} aprovada(s)</span>
            </div>
            <div className="chart-track">
              <span style={{ height: `${Math.max((value / maximum) * 100, 4)}%` }} />
            </div>
            <small>{date.replace(".", "")}</small>
          </div>
        );
      })}
    </div>
  );
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "all";
  const period = periods[periodKey];
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const active=await getActiveProject(authData.user.id);
  if(!active.project)redirect("/dashboard/projetos");

  const database = getDatabase();
  const metricsResult = await database.pool.query<{
    gross_revenue: string;
    net_revenue: string;
    reversed_revenue: string;
    approved_payments: number;
    reversed_payments: number;
    pending_payments: number;
  }>(
    `with accessible_projects as (
       select project.id
         from public.projects project
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = project.organization_id
          and membership.user_id = app_user.id
        where project.id=$3 and (not exists (
                select 1
                  from public.project_memberships restricted
                 where restricted.membership_id = membership.id
              )
           or exists (
                select 1
                  from public.project_memberships allowed
                 where allowed.membership_id = membership.id
                   and allowed.project_id = project.id
              ))
     ),
     financial as (
       select
         coalesce(sum(event.financial_effect)
           filter (where event.financial_effect > 0), 0) as gross_revenue,
         coalesce(sum(event.financial_effect), 0) as net_revenue,
         abs(coalesce(sum(event.financial_effect)
           filter (where event.financial_effect < 0), 0)) as reversed_revenue,
         count(distinct event.payment_id)
           filter (where event.financial_effect > 0) as approved_payments,
         count(distinct event.payment_id)
           filter (where event.financial_effect < 0) as reversed_payments
         from public.normalized_payment_events event
        where event.data_scope = 'production'
          and event.project_id in (select id from accessible_projects)
          and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))
     ),
     pending as (
       select count(*) as pending_payments
         from public.payments payment
        where payment.data_scope = 'production'
          and payment.status = 'pending'
          and payment.project_id in (select id from accessible_projects)
          and ($2::int is null or payment.created_at >= now() - ($2 * interval '1 day'))
     )
     select financial.gross_revenue::text,
            financial.net_revenue::text,
            financial.reversed_revenue::text,
            financial.approved_payments::int,
            financial.reversed_payments::int,
            pending.pending_payments::int
       from financial cross join pending`,
    [authData.user.id, period.days,active.project.id],
  );
  const dailyResult = await database.pool.query<DailyMetric>(
    `with accessible_projects as (
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
     )
     select to_char(date_trunc('day', event.occurred_at), 'YYYY-MM-DD') as day,
            coalesce(sum(event.financial_effect)
              filter (where event.financial_effect > 0), 0)::text as gross_revenue,
            coalesce(sum(event.financial_effect), 0)::text as net_revenue,
            count(distinct event.payment_id)
              filter (where event.financial_effect > 0)::int as approved_payments
       from public.normalized_payment_events event
      where event.data_scope = 'production'
        and event.project_id in (select id from accessible_projects)
        and ($2::int is null or event.occurred_at >= now() - ($2 * interval '1 day'))
      group by date_trunc('day', event.occurred_at)
      order by date_trunc('day', event.occurred_at)
      limit 90`,
    [authData.user.id, period.days,active.project.id],
  );
  const metaOverview=(await database.pool.query<MetaOverview>(
    `select
       (select count(*)::int from public.meta_ad_accounts account
         where account.project_id=$1) accounts,
       (select count(*)::int from public.meta_campaigns campaign
         where campaign.project_id=$1) campaigns,
       (select count(*)::int from public.meta_ads ad
         where ad.project_id=$1) ads,
       (select max(metric_date)::text from public.meta_ad_insights_daily insight
         where insight.project_id=$1) last_metric_date,
       (select count(*)::int from public.meta_sync_runs run
         where run.project_id=$1
           and run.status in ('queued','running','failed_retryable')) active_runs,
       (select count(*)::int from public.connections connection
         join lateral(
           select run.status from public.meta_sync_runs run
            where run.connection_id=connection.id
            order by run.created_at desc limit 1
         ) latest on true
         where connection.project_id=$1 and connection.provider='meta_ads'
           and latest.status='failed_terminal') failed_connections`,
    [active.project.id],
  )).rows[0];
  const metaSpend=(await database.pool.query<MetaSpend>(
    `select coalesce(currency,'BRL') currency,sum(spend)::text spend
       from public.meta_ad_insights_daily
      where project_id=$1 and metric_date>=current_date-29
      group by coalesce(currency,'BRL') order by currency`,
    [active.project.id],
  )).rows;
  const metrics = metricsResult.rows[0] ?? {
    gross_revenue: "0",
    net_revenue: "0",
    reversed_revenue: "0",
    approved_payments: 0,
    reversed_payments: 0,
    pending_payments: 0,
  };
  const currency = active.project.currency;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
  const averageTicket =
    metrics.approved_payments > 0
      ? Number(metrics.gross_revenue) / metrics.approved_payments
      : 0;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard">
          <nav aria-label="Período do dashboard" className="period-filter topbar-period">
            {Object.entries(periods).map(([key, option]) => (
              <a
                aria-current={key === periodKey ? "page" : undefined}
                className={key === periodKey ? "period-active" : undefined}
                href={`/dashboard?period=${key}`}
                key={key}
              >
                {option.label}
              </a>
            ))}
          </nav>
        </DashboardTopbar>

        <div className="dashboard-main">
          <header className="dashboard-titlebar compact-titlebar">
            <div>
              <p className="eyebrow">Painel executivo</p>
              <h1>Visão geral</h1>
              <p className="dashboard-context">
                Acompanhe receita, pagamentos e saúde da operação em um só lugar.
              </p>
            </div>
          </header>

          <section className="executive-grid" aria-label="Indicadores principais">
            <article className="kpi-card kpi-primary">
              <div><span className="kpi-icon">R$</span><p>Receita bruta</p></div>
              <strong>{money.format(Number(metrics.gross_revenue))}</strong>
              <small>{metrics.approved_payments} pagamentos aprovados</small>
            </article>
            <article className="kpi-card">
              <div><span className="kpi-icon">↗</span><p>Receita líquida</p></div>
              <strong>{money.format(Number(metrics.net_revenue))}</strong>
              <small>Após reembolsos e chargebacks</small>
            </article>
            <article className="kpi-card">
              <div><span className="kpi-icon">✓</span><p>Vendas aprovadas</p></div>
              <strong>{metrics.approved_payments}</strong>
              <small>{metrics.pending_payments} pagamentos pendentes</small>
            </article>
            <article className="kpi-card">
              <div><span className="kpi-icon">◉</span><p>Ticket médio</p></div>
              <strong>{money.format(averageTicket)}</strong>
              <small>Valor bruto por pagamento</small>
            </article>
          </section>

          <section className="analytics-grid">
            <article className="dashboard-card performance-card">
              <header className="card-header">
                <div>
                  <p className="panel-label">Desempenho financeiro</p>
                  <h2>Receita por dia</h2>
                </div>
                <div className="chart-legend"><i />Receita bruta</div>
              </header>
              <TrendChart rows={dailyResult.rows} money={money} />
              <footer className="chart-footer">
                <span>{period.description}</span>
                <span>Lastlink · {currency} · {active.project.timezone}</span>
              </footer>
            </article>

            <article className="dashboard-card health-card">
              <header className="card-header">
                <div>
                  <p className="panel-label">Saúde financeira</p>
                  <h2>Resumo do período</h2>
                </div>
              </header>
              <div className="health-row">
                <span><i className="health-good" />Aprovado</span>
                <strong>{money.format(Number(metrics.gross_revenue))}</strong>
              </div>
              <div className="health-row">
                <span><i className="health-alert" />Revertido</span>
                <strong>{money.format(Number(metrics.reversed_revenue))}</strong>
              </div>
              <div className="health-row">
                <span><i className="health-muted" />Pendente</span>
                <strong>{metrics.pending_payments}</strong>
              </div>
              <a className="card-action" href="/dashboard/integracoes/lastlink">
                Ver integração Lastlink <span>→</span>
              </a>
            </article>
          </section>

          <section className="dashboard-card meta-overview-card">
            <header className="card-header">
              <div><p className="panel-label">Meta Ads · somente leitura</p>
                <h2>Aquisição e sincronização</h2></div>
              <Link className="card-action" href="/dashboard/campanhas">Abrir campanhas <span>→</span></Link>
            </header>
            <div className="creative-foundation-grid">
              <article><span>Contas</span><strong>{metaOverview?.accounts??0}</strong></article>
              <article><span>Campanhas</span><strong>{metaOverview?.campaigns??0}</strong></article>
              <article><span>Anúncios</span><strong>{metaOverview?.ads??0}</strong></article>
              <article><span>Fila ativa</span><strong>{metaOverview?.active_runs??0}</strong>
                <small>{metaOverview?.failed_connections??0} conexão(ões) com falha terminal</small></article>
            </div>
            <div className="meta-spend-summary">
              <div><span>Investimento observado · 30 dias</span>
                {metaSpend.length?metaSpend.map(item=><strong key={item.currency}>
                  {new Intl.NumberFormat("pt-BR",{style:"currency",
                    currency:item.currency}).format(Number(item.spend))}
                  <small>{item.currency}</small>
                </strong>):<strong>Sem insights</strong>}</div>
              <p>Última métrica: {metaOverview?.last_metric_date
                ?new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(
                  new Date(`${metaOverview.last_metric_date}T00:00:00Z`))
                :"não disponível"}</p>
            </div>
          </section>

          <p className="metric-footnote">
            Fonte Lastlink · produção · regra financeira v1 · valores brutos não distribuem pedidos entre produto principal e order bumps.
          </p>
        </div>
      </section>
    </main>
  );
}
