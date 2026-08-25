import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ period?: string }>;
};

const periods = {
  "24h": { label: "24 horas", days: 1 },
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
} as const;

type Diagnostic = {
  failed_events: number;
  quarantined_events: number;
  backlog_events: number;
  duplicate_events: number;
  total_orders: number;
  missing_source_orders: number;
  reversed_payments: number;
  inactive_connections: number;
  connections_without_events: number;
};

type AlertItem = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  evidence: string;
  impact: string;
  recommendation: string;
  href: string;
};

type PersistedIssue = {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info";
  status: "open" | "resolved";
  occurrences: number;
  last_detected_at: string;
  resolved_at: string | null;
  connection_name: string | null;
  issue_type: string;
  evidence: Record<string, unknown>;
  rule_version: string;
};

function persistedEvidence(issue: PersistedIssue) {
  if (issue.issue_type === "sales_volume_anomaly") {
    const current = Number(issue.evidence.currentOrders ?? 0);
    const average = Number(issue.evidence.baselineDailyAverage ?? 0);
    const factor = Number(issue.evidence.factor ?? 0);
    const days = Number(issue.evidence.baselineObservedDays ?? 0);
    return `${current} pedidos nas últimas 24h; média de ${average.toLocaleString("pt-BR")} em ${days} dias observados; aumento de ${factor.toLocaleString("pt-BR")}×.`;
  }
  const count = Number(issue.evidence.count ?? 0);
  return count > 0 ? `${count} ocorrência(s) na avaliação mais recente.` : "Evidência registrada pelo monitor.";
}

export default async function AlertsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "7d";
  const period = periods[periodKey];
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const {project}=await getActiveProject(authData.user.id);
  if(!project)redirect("/dashboard/projetos");
  const database = getDatabase();
  const result = await database.pool.query<Diagnostic>(
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
     ),
     raw_quality as (
       select count(*) filter (
                where event.processing_status in ('failed_retryable','failed_terminal')
              )::int as failed_events,
              count(*) filter (where event.processing_status = 'quarantined')::int as quarantined_events,
              count(*) filter (
                where event.processing_status in ('received','queued','processing')
              )::int as backlog_events,
              count(*) filter (where event.processing_status = 'duplicate')::int as duplicate_events
         from public.raw_events event
        where event.project_id in (select id from accessible_projects)
          and event.received_at >= now() - ($2 * interval '1 day')
     ),
     selected_orders as (
       select orders.id
         from public.commerce_orders orders
        where orders.data_scope = 'production'
          and orders.project_id in (select id from accessible_projects)
          and orders.occurred_at >= now() - ($2 * interval '1 day')
     ),
     latest_attribution as (
       select distinct on (attribution.order_id)
              attribution.order_id, attribution.utm_source, attribution.src
         from public.order_attributions attribution
         join selected_orders orders on orders.id = attribution.order_id
        order by attribution.order_id, attribution.created_at desc
     ),
     attribution_quality as (
       select (select count(*) from selected_orders)::int as total_orders,
              count(*) filter (
                where coalesce(nullif(attribution.utm_source, ''), nullif(attribution.src, '')) is null
              )::int
              + ((select count(*) from selected_orders) - count(*))::int
                as missing_source_orders
         from latest_attribution attribution
     ),
     financial_quality as (
       select count(distinct event.payment_id)
                filter (where event.financial_effect < 0)::int as reversed_payments
         from public.normalized_payment_events event
        where event.data_scope = 'production'
          and event.project_id in (select id from accessible_projects)
          and event.occurred_at >= now() - ($2 * interval '1 day')
     ),
     connection_quality as (
       select count(*) filter (where connection.status <> 'active')::int as inactive_connections,
              count(*) filter (
                where connection.status = 'active' and connection.last_event_at is null
              )::int as connections_without_events
         from public.connections connection
        where connection.project_id in (select id from accessible_projects)
     )
     select raw_quality.*, attribution_quality.*, financial_quality.*,
            connection_quality.*
       from raw_quality cross join attribution_quality
       cross join financial_quality cross join connection_quality`,
    [authData.user.id, period.days,project.id],
  );
  const persistedResult = await database.pool.query<PersistedIssue>(
    `select issue.id, issue.title, issue.severity, issue.status,
            issue.occurrences, issue.last_detected_at::text,
            issue.resolved_at::text, connection.name as connection_name
            ,issue.issue_type, issue.evidence, issue.rule_version
       from public.data_quality_issues issue
       left join public.connections connection on connection.id = issue.connection_id
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = issue.organization_id
        and membership.user_id = app_user.id
      where issue.project_id=$2 and (not exists (
              select 1 from public.project_memberships restricted
               where restricted.membership_id = membership.id
            )
         or exists (
              select 1 from public.project_memberships allowed
               where allowed.membership_id = membership.id
                 and allowed.project_id = issue.project_id
            ))
      order by case when issue.status = 'open' then 0 else 1 end,
               issue.last_detected_at desc
      limit 30`,
    [authData.user.id,project.id],
  );
  const diagnostic = result.rows[0] ?? {
    failed_events: 0,
    quarantined_events: 0,
    backlog_events: 0,
    duplicate_events: 0,
    total_orders: 0,
    missing_source_orders: 0,
    reversed_payments: 0,
    inactive_connections: 0,
    connections_without_events: 0,
  };
  const alerts: AlertItem[] = [];
  if (diagnostic.failed_events > 0) {
    alerts.push({
      id: "processing-failures", severity: "critical",
      title: "Falhas no processamento",
      evidence: `${diagnostic.failed_events} evento(s) falharam no período.`,
      impact: "Eventos podem não estar disponíveis nas métricas normalizadas.",
      recommendation: "Abra a qualidade dos dados, confira os códigos de erro e reprocesse com idempotência.",
      href: "/dashboard/qualidade",
    });
  }
  if (diagnostic.quarantined_events > 0) {
    alerts.push({
      id: "quarantine", severity: "warning", title: "Eventos em quarentena",
      evidence: `${diagnostic.quarantined_events} evento(s) aguardam conferência.`,
      impact: "Payloads inválidos, parciais ou desconhecidos não alimentam métricas.",
      recommendation: "Revise o contrato recebido antes de liberar qualquer reprocessamento.",
      href: "/dashboard/qualidade",
    });
  }
  if (diagnostic.backlog_events > 0) {
    alerts.push({
      id: "backlog", severity: "warning", title: "Fila de processamento pendente",
      evidence: `${diagnostic.backlog_events} evento(s) ainda estão na fila.`,
      impact: "O painel pode apresentar atraso temporário.",
      recommendation: "Acompanhe a fila; investigue apenas se o volume não diminuir.",
      href: "/dashboard/qualidade",
    });
  }
  if (diagnostic.missing_source_orders > 0) {
    const percentage = diagnostic.total_orders > 0
      ? (diagnostic.missing_source_orders / diagnostic.total_orders) * 100
      : 0;
    alerts.push({
      id: "missing-source", severity: "warning", title: "Pedidos sem origem registrada",
      evidence: `${diagnostic.missing_source_orders} de ${diagnostic.total_orders} pedido(s) sem utm_source ou src (${percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%).`,
      impact: "A comparação por fonte fica incompleta.",
      recommendation: "Revise os links de checkout e confirme a preservação das UTMs até a Lastlink.",
      href: "/dashboard/atribuicao",
    });
  }
  if (diagnostic.inactive_connections > 0) {
    alerts.push({
      id: "inactive-connections", severity: "critical", title: "Conexão não está ativa",
      evidence: `${diagnostic.inactive_connections} conexão(ões) inativa(s), revogada(s) ou com erro.`,
      impact: "Novos eventos dessa origem podem deixar de ser aceitos.",
      recommendation: "Revise o estado e o token da conexão Lastlink.",
      href: "/dashboard/integracoes/lastlink",
    });
  }
  if (diagnostic.connections_without_events > 0) {
    alerts.push({
      id: "no-events", severity: "info", title: "Conexão ainda sem atividade",
      evidence: `${diagnostic.connections_without_events} conexão(ões) ativa(s) nunca receberam evento.`,
      impact: "Não há evidência suficiente para confirmar o funcionamento ponta a ponta.",
      recommendation: "Envie um evento de teste ou aguarde uma ocorrência real. Ausência de venda não é tratada como falha.",
      href: "/dashboard/integracoes/lastlink",
    });
  }
  if (diagnostic.reversed_payments > 0) {
    alerts.push({
      id: "reversals", severity: "info", title: "Reversões financeiras observadas",
      evidence: `${diagnostic.reversed_payments} pagamento(s) com reembolso ou chargeback.`,
      impact: "A receita líquida do período foi reduzida.",
      recommendation: "Confira a jornada dos clientes e os pedidos revertidos.",
      href: "/dashboard/vendas?status=refunded",
    });
  }

  const criticalCount = alerts.filter((alert) => alert.severity === "critical").length;
  const warningCount = alerts.filter((alert) => alert.severity === "warning").length;
  const infoCount = alerts.filter((alert) => alert.severity === "info").length;
  const issueDate = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/alertas" footerLabel="Diagnóstico sob demanda" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/alertas" statusLabel={criticalCount ? "Ação necessária" : "Monitorado"} statusTone={criticalCount ? "attention" : "default"}>
          <nav aria-label="Período dos alertas" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => <a className={key === periodKey ? "period-active" : undefined} href={`/dashboard/alertas?period=${key}`} key={key}>{option.label}</a>)}
          </nav>
          <Link className="icon-button" href="/dashboard/alertas/historico">Histórico</Link>
        </DashboardTopbar>
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div><p className="eyebrow">Diagnóstico operacional</p><h1>Central de alertas</h1><p className="dashboard-context">Cada sinal apresenta evidência, possível impacto e uma próxima ação segura.</p></div>
          </header>

          <section className="alert-summary">
            <article><span className="alert-dot critical-dot" /><p><strong>{criticalCount}</strong><small>críticos</small></p></article>
            <article><span className="alert-dot warning-dot" /><p><strong>{warningCount}</strong><small>atenção</small></p></article>
            <article><span className="alert-dot info-dot" /><p><strong>{infoCount}</strong><small>informativos</small></p></article>
            <article><span className="alert-dot protected-dot" /><p><strong>{diagnostic.duplicate_events}</strong><small>duplicidades bloqueadas</small></p></article>
          </section>

          {alerts.length ? (
            <section className="alerts-list">
              {alerts.map((alert) => (
                <article className={`dashboard-card alert-card alert-${alert.severity}`} key={alert.id}>
                  <span className="alert-severity">{alert.severity === "critical" ? "Crítico" : alert.severity === "warning" ? "Atenção" : "Informativo"}</span>
                  <div><h2>{alert.title}</h2><p className="alert-evidence">{alert.evidence}</p></div>
                  <div className="alert-guidance"><p><strong>Impacto</strong>{alert.impact}</p><p><strong>Recomendação</strong>{alert.recommendation}</p></div>
                  <Link href={alert.href}>Ver evidências →</Link>
                </article>
              ))}
            </section>
          ) : (
            <section className="dashboard-card all-clear-state"><span>✓</span><h2>Nenhum alerta encontrado</h2><p>Não há falha, quarentena, fila, origem ausente ou conexão degradada no período.</p></section>
          )}
          <section className="dashboard-card issue-history-card">
            <header className="card-header">
              <div><p className="panel-label">Monitor automático</p><h2>Histórico persistente</h2></div>
              <div><span className="result-count">Avaliação a cada minuto</span>
               <Link href="/dashboard/alertas/historico">Ver histórico completo</Link></div>
            </header>
            {persistedResult.rows.length ? (
              <div className="issue-history-list">
                {persistedResult.rows.map((issue) => (
                  <div key={issue.id}>
                    <span className={`alert-dot ${issue.severity}-dot`} />
                    <p>
                      <strong>{issue.title}</strong>
                      <small>{persistedEvidence(issue)}</small>
                      <small>{issue.connection_name ?? "Escopo do projeto"} · regra {issue.rule_version} · detectado {issueDate.format(new Date(issue.last_detected_at))}</small>
                    </p>
                    <span>{issue.occurrences} avaliação(ões)</span>
                    <strong className={`issue-status issue-${issue.status}`}>{issue.status === "open" ? "Aberto" : "Resolvido"}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="compact-empty">Nenhuma ocorrência persistente foi aberta pelo monitor.</div>
            )}
          </section>
          <div className="method-note"><strong>Escopo desta versão</strong><p>Os diagnósticos amplos são recalculados ao abrir a tela. O monitor persistente também acompanha falhas, quarentena, backlog parado e anomalias conservadoras de volume. O sinal de volume é apenas informativo, exige histórico mínimo e nunca altera campanhas.</p></div>
        </div>
      </section>
    </main>
  );
}
