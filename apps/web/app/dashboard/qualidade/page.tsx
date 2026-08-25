import { redirect } from "next/navigation";
import Link from "next/link";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import {retryRawEvent} from "./actions";
import {processingStatusLabel,qualityErrorLabel,validationStatusLabel} from "../../../lib/data-quality-labels";

export const dynamic = "force-dynamic";

type QualityProps = {
  searchParams: Promise<{ period?: string; status?: string; connection?: string; notice?: string }>;
};

const periods = {
  "24h": { label: "24 horas", days: 1 },
  "7d": { label: "7 dias", days: 7 },
  "30d": { label: "30 dias", days: 30 },
  all: { label: "Tudo", days: null },
} as const;
const statusFilters={
  all:"Todos",normalized:"Normalizados",duplicate:"Duplicados",backlog:"Na fila",
  failed:"Falhas",quarantined:"Quarentena",partial:"Parciais",unknown:"Desconhecidos",
} as const;

type QualitySummary = {
  received_events: number;
  normalized_events: number;
  duplicate_events: number;
  backlog_events: number;
  failed_events: number;
  quarantined_events: number;
  partial_events: number;
  unknown_events: number;
};

type ConnectionHealth = {
  id: string;
  name: string;
  status: string;
  project_name: string;
  product_name: string | null;
  last_event_at: string | null;
  lag_minutes: number | null;
  events: number;
  normalized: number;
  backlog: number;
  failures: number;
  quarantined: number;
};
type ConnectionOption={id:string;name:string;product_name:string|null};
type RecentEvent={id:string;connection_name:string;external_event_name:string|null;
 processing_status:string;validation_status:string;processing_attempts:number;
 error_code:string|null;received_at:Date};

function healthFor(connection: ConnectionHealth) {
  if (connection.status !== "active" || connection.failures > 0) {
    return { label: "Com falha", tone: "danger" };
  }
  if (connection.quarantined > 0 || connection.backlog > 0) {
    return { label: "Atenção", tone: "warning" };
  }
  if (connection.last_event_at === null) {
    return { label: "Sem eventos", tone: "neutral" };
  }
  return { label: "Operacional", tone: "success" };
}

function lagLabel(minutes: number | null) {
  if (minutes === null) return "Nenhum evento recebido";
  if (minutes < 1) return "há menos de 1 minuto";
  if (minutes < 60) return `há ${Math.floor(minutes)} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)} h`;
  return `há ${Math.floor(minutes / 1440)} dia(s)`;
}

export default async function QualityPage({ searchParams }: QualityProps) {
  const params = await searchParams;
  const periodKey =
    params.period && params.period in periods
      ? (params.period as keyof typeof periods)
      : "7d";
  const period = periods[periodKey];
  const statusKey=params.status&&params.status in statusFilters
    ?params.status as keyof typeof statusFilters:"all";
  const connectionId=/^[0-9a-f-]{36}$/i.test(params.connection??"")?params.connection!:"";
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const {project}=await getActiveProject(authData.user.id);
  if(!project)redirect("/dashboard/projetos");
  const canRetry=["owner","administrator"].includes(project.role);
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

  const [summaryResult, connectionsResult,connectionOptionsResult,recentEventsResult] = await Promise.all([
    database.pool.query<QualitySummary>(
      `with ${accessCte}
       select count(*)::int as received_events,
              count(*) filter (where event.processing_status = 'normalized')::int as normalized_events,
              count(*) filter (where event.processing_status = 'duplicate')::int as duplicate_events,
              count(*) filter (where event.processing_status in ('received','queued','processing'))::int as backlog_events,
              count(*) filter (where event.processing_status in ('failed_retryable','failed_terminal'))::int as failed_events,
              count(*) filter (where event.processing_status = 'quarantined')::int as quarantined_events,
              count(*) filter (where event.validation_status = 'partial')::int as partial_events,
              count(*) filter (where event.validation_status = 'unknown_event')::int as unknown_events
         from public.raw_events event
        where event.project_id in (select id from accessible_projects)
          and ($2::int is null or event.received_at >= now() - ($2 * interval '1 day'))
          and ($4='all' or ($4='normalized' and event.processing_status='normalized')
           or ($4='duplicate' and event.processing_status='duplicate')
           or ($4='backlog' and event.processing_status in ('received','queued','processing'))
           or ($4='failed' and event.processing_status in ('failed_retryable','failed_terminal'))
           or ($4='quarantined' and event.processing_status='quarantined')
           or ($4='partial' and event.validation_status='partial')
           or ($4='unknown' and event.validation_status='unknown_event'))
          and ($5='' or event.connection_id::text=$5)`,
      [authData.user.id, period.days,project.id,statusKey,connectionId],
    ),
    database.pool.query<ConnectionHealth>(
      `with ${accessCte}
       select connection.id,
              connection.name,
              connection.status::text,
              project.name as project_name,
              connection.configuration->>'productName' as product_name,
              connection.last_event_at::text,
              case when connection.last_event_at is null then null
                   else extract(epoch from (now() - connection.last_event_at)) / 60
              end::float8 as lag_minutes,
              count(event.id)::int as events,
              count(event.id) filter (where event.processing_status = 'normalized')::int as normalized,
              count(event.id) filter (where event.processing_status in ('received','queued','processing'))::int as backlog,
              count(event.id) filter (where event.processing_status in ('failed_retryable','failed_terminal'))::int as failures,
              count(event.id) filter (where event.processing_status = 'quarantined')::int as quarantined
         from public.connections connection
         join public.projects project on project.id = connection.project_id
         left join public.raw_events event
           on event.connection_id = connection.id
          and ($2::int is null or event.received_at >= now() - ($2 * interval '1 day'))
          and ($4='all' or ($4='normalized' and event.processing_status='normalized')
           or ($4='duplicate' and event.processing_status='duplicate')
           or ($4='backlog' and event.processing_status in ('received','queued','processing'))
           or ($4='failed' and event.processing_status in ('failed_retryable','failed_terminal'))
           or ($4='quarantined' and event.processing_status='quarantined')
           or ($4='partial' and event.validation_status='partial')
           or ($4='unknown' and event.validation_status='unknown_event'))
        where connection.project_id in (select id from accessible_projects)
          and ($5='' or connection.id::text=$5)
        group by connection.id, project.name
        order by connection.created_at desc`,
      [authData.user.id, period.days,project.id,statusKey,connectionId],
    ),
    database.pool.query<ConnectionOption>(`select id,name,configuration->>'productName' product_name
      from public.connections where project_id=$1 order by created_at desc`,[project.id]),
    database.pool.query<RecentEvent>(`select event.id,connection.name connection_name,
      event.external_event_name,event.processing_status::text,event.validation_status::text,event.received_at
      ,event.processing_attempts,event.error_code
      from public.raw_events event join public.connections connection on connection.id=event.connection_id
      where event.project_id=$1 and ($2::int is null or event.received_at>=now()-($2*interval '1 day'))
       and ($3='all' or ($3='normalized' and event.processing_status='normalized')
        or ($3='duplicate' and event.processing_status='duplicate')
        or ($3='backlog' and event.processing_status in ('received','queued','processing'))
        or ($3='failed' and event.processing_status in ('failed_retryable','failed_terminal'))
        or ($3='quarantined' and event.processing_status='quarantined')
        or ($3='partial' and event.validation_status='partial')
        or ($3='unknown' and event.validation_status='unknown_event'))
       and ($4='' or event.connection_id::text=$4)
      order by event.received_at desc,event.id limit 50`,
      [project.id,period.days,statusKey,connectionId]),
  ]);

  const summary = summaryResult.rows[0] ?? {
    received_events: 0,
    normalized_events: 0,
    duplicate_events: 0,
    backlog_events: 0,
    failed_events: 0,
    quarantined_events: 0,
    partial_events: 0,
    unknown_events: 0,
  };
  const completion =
    summary.received_events > 0
      ? (summary.normalized_events / summary.received_events) * 100
      : 0;
  const hasIncident =
    summary.failed_events > 0 ||
    summary.quarantined_events > 0 ||
    summary.backlog_events > 0;

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/qualidade" footerLabel="Monitoramento ativo" />

      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/qualidade" statusLabel={hasIncident ? "Requer atenção" : "Operacional"} statusTone={hasIncident ? "attention" : "default"}>
          <nav aria-label="Período da qualidade" className="period-filter topbar-period-filter">
            {Object.entries(periods).map(([key, option]) => (
              <a className={key === periodKey ? "period-active" : undefined}
                 href={`/dashboard/qualidade?period=${key}&status=${statusKey}&connection=${connectionId}`} key={key}>{option.label}</a>
            ))}
          </nav>
          <a className="icon-button" href={`/dashboard/qualidade/export?period=${periodKey}&status=${statusKey}&connection=${connectionId}`}>Exportar</a>
        </DashboardTopbar>

        <div className="dashboard-main">
          {params.notice?<div className={params.notice==="retry-queued"?"notice notice-success":"notice notice-error"}>
            {params.notice==="retry-queued"?"Evento recolocado na fila com auditoria. O worker fará uma nova tentativa.":
             params.notice==="retry-forbidden"?"Somente proprietários e administradores podem solicitar retentativa.":
             "O evento não está disponível para retentativa manual."}
          </div>:null}
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Observabilidade</p>
              <h1>Qualidade dos dados</h1>
              <p className="dashboard-context">Acompanhe recepção, processamento e exceções das integrações.</p>
            </div>
          </header>
          <nav className="status-filter" aria-label="Estado operacional">
            {Object.entries(statusFilters).map(([key,label])=><a key={key}
             className={key===statusKey?"active":undefined}
             href={`/dashboard/qualidade?period=${periodKey}&status=${key}&connection=${connectionId}`}>{label}</a>)}
          </nav>
          <form method="get" className="filter-form">
            <input type="hidden" name="period" value={periodKey}/><input type="hidden" name="status" value={statusKey}/>
            <label>Conexão<select name="connection" defaultValue={connectionId}>
              <option value="">Todas as conexões</option>
              {connectionOptionsResult.rows.map(item=><option value={item.id} key={item.id}>
                {item.product_name??item.name}</option>)}
            </select></label><button type="submit">Aplicar</button>
          </form>

          <section className="quality-summary">
            <article className="kpi-card kpi-primary">
              <div><span className="kpi-icon">↓</span><p>Recebidos</p></div>
              <strong>{summary.received_events}</strong><small>Webhooks brutos preservados</small>
            </article>
            <article className="kpi-card">
              <div><span className="kpi-icon">✓</span><p>Normalizados</p></div>
              <strong>{summary.normalized_events}</strong><small>{completion.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% dos recebidos</small>
            </article>
            <article className="kpi-card">
              <div><span className="kpi-icon">≡</span><p>Duplicados</p></div>
              <strong>{summary.duplicate_events}</strong><small>Sem novo efeito financeiro</small>
            </article>
            <article className={`kpi-card ${hasIncident ? "quality-alert-card" : ""}`}>
              <div><span className="kpi-icon">!</span><p>Exceções abertas</p></div>
              <strong>{summary.failed_events + summary.quarantined_events + summary.backlog_events}</strong>
              <small>Falhas, quarentena e fila</small>
            </article>
          </section>

          <section className="dashboard-card">
            <header className="card-header"><div><p className="panel-label">Eventos</p>
              <h2>Ocorrências mais recentes</h2></div><small>Até 50 itens · sem payload</small></header>
            {recentEventsResult.rows.length?<div className="table-scroll"><table className="sales-table">
              <thead><tr><th>Recebido em</th><th>Conexão</th><th>Evento</th>
                <th>Processamento</th><th>Validação</th><th>Tentativas</th><th>Falha</th><th>Ação</th></tr></thead>
              <tbody>{recentEventsResult.rows.map(event=><tr key={event.id}>
                <td>{event.received_at.toLocaleString("pt-BR")}</td><td>{event.connection_name}</td>
                <td><Link href={`/dashboard/qualidade/${event.id}`}>
                  {event.external_event_name??"Não informado"}</Link></td>
                <td>{processingStatusLabel(event.processing_status)}</td>
                <td>{validationStatusLabel(event.validation_status)}</td>
                <td>{event.processing_attempts}</td>
                <td>{qualityErrorLabel(event.error_code)??"—"}</td><td>
                  {canRetry&&event.processing_status==="failed_retryable"?<form action={retryRawEvent}>
                    <input type="hidden" name="event_id" value={event.id}/>
                    <input type="hidden" name="return_period" value={periodKey}/>
                    <input type="hidden" name="return_status" value={statusKey}/>
                    <input type="hidden" name="return_connection" value={connectionId}/>
                    <button type="submit">Tentar novamente</button>
                  </form>:<small>—</small>}
                </td>
              </tr>)}</tbody></table></div>:
              <div className="compact-empty">Nenhum evento corresponde ao recorte atual.</div>}
          </section>

          <section className="quality-layout">
            <article className="dashboard-card connections-health-card">
              <header className="card-header">
                <div><p className="panel-label">Conexões</p><h2>Estado operacional</h2></div>
                <a className="inline-action" href="/dashboard/integracoes/lastlink">Gerenciar →</a>
              </header>
              {connectionsResult.rows.length ? (
                <div className="connection-health-list">
                  {connectionsResult.rows.map((connection) => {
                    const health = healthFor(connection);
                    return (
                      <div key={connection.id}>
                        <div className="connection-identity">
                          <span className={`health-indicator health-${health.tone}`} />
                          <p><strong>{connection.product_name ?? connection.name}</strong><small>{connection.project_name} · Lastlink</small></p>
                        </div>
                        <span className={`health-pill health-${health.tone}`}>{health.label}</span>
                        <div className="connection-stats">
                          <span><strong>{connection.events}</strong> recebidos</span>
                          <span><strong>{connection.normalized}</strong> normalizados</span>
                          <span><strong>{connection.backlog}</strong> na fila</span>
                        </div>
                        <small className="last-activity">Última atividade {lagLabel(connection.lag_minutes)}</small>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="chart-empty"><strong>Nenhuma conexão disponível</strong><p>Cadastre uma integração para iniciar o monitoramento.</p></div>
              )}
            </article>

            <article className="dashboard-card exception-card">
              <header className="card-header"><div><p className="panel-label">Diagnóstico</p><h2>Detalhamento</h2></div></header>
              <div className="loss-list">
                <div><span>Fila de processamento</span><strong>{summary.backlog_events}</strong></div>
                <div><span>Falhas de processamento</span><strong>{summary.failed_events}</strong></div>
                <div><span>Em quarentena</span><strong>{summary.quarantined_events}</strong></div>
                <div><span>Payloads parciais</span><strong>{summary.partial_events}</strong></div>
                <div><span>Eventos desconhecidos</span><strong>{summary.unknown_events}</strong></div>
              </div>
              <div className={`quality-verdict ${hasIncident ? "verdict-warning" : "verdict-good"}`}>
                <strong>{hasIncident ? "Há itens para conferir" : "Nenhuma exceção operacional aberta"}</strong>
                <p>{hasIncident ? "Os dados brutos permanecem preservados para reprocessamento seguro." : "Os eventos do período foram recebidos sem fila, falha ou quarentena."}</p>
              </div>
            </article>
          </section>

          <p className="metric-footnote">
            Fonte interna · eventos brutos e conexões · estados de processamento atuais · fuso {project?.timezone ?? "America/Sao_Paulo"}.
          </p>
        </div>
      </section>
    </main>
  );
}
