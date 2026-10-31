import { getDatabase } from "../../../../lib/database";
import {
  correctMetaAccountCurrency,
  queueMetaSyncNow,
  revokeMetaConnection,
  updateMetaSyncSchedule,
  validateIntegrationConnection,
} from "../actions";
import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

import Link from "next/link";

export const dynamic = "force-dynamic";

type MetaCatalogRow = {
  account_id: string;
  account_name: string;
  account_external_id: string;
  currency: string | null;
  currency_status: string;
  campaign_count: string;
  ad_set_count: string;
  ad_count: string;
  creative_count: string;
  spend: string;
  impressions: string;
  clicks: string;
  last_insight_date: string | null;
  last_synced_at: Date;
};
type MetaSyncRow = { connection_id: string; occurred_at: Date; details: Record<string, unknown> };
type MetaScheduleRow = { connection_id: string; enabled: boolean; interval_minutes: number;
  next_run_at: Date | null; last_run_at: Date | null; last_status: string | null;
  last_finished_at: Date | null; last_error_code: string | null };
type MetaRunRow = { id: string; connection_id: string; status: string; attempts: number;
  scheduled_for: Date | null; started_at: Date | null; finished_at: Date | null;
  account_count: number; campaign_count: number; ad_set_count: number; ad_count: number;
  creative_count: number; insight_count: number; error_code: string | null;
  mode: "manual" | "scheduled" };

export default async function MetaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { configured, scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  const database = getDatabase();
  const metaConnections = configured.filter((item) => item.provider === "meta_ads");
  const metaSystemConfig = metaConnections.find((item) =>
    String(item.configuration.authorizationMode ?? "system_user") === "system_user" &&
    item.has_secret);
  const metaAppConfig = byProvider.get("meta_ads_app") ?? metaSystemConfig;
  const metaSyncRows = (await database.pool.query<MetaSyncRow>(
    `select distinct on (target_id) target_id connection_id,occurred_at,
            coalesce(after,'{}'::jsonb) details
       from public.audit_logs
      where project_id=$1 and action='meta_catalog_synchronized'
      order by target_id,occurred_at desc`,
    [scope.project_id],
  )).rows;
  const metaSyncByConnection = new Map(metaSyncRows.map((item) => [item.connection_id, item]));
  const metaSchedules = (await database.pool.query<MetaScheduleRow>(
    `select connection.id connection_id,coalesce(schedule.enabled,false) enabled,
            coalesce(schedule.interval_minutes,360)::int interval_minutes,
            schedule.next_run_at,schedule.last_run_at,
            latest.status last_status,latest.finished_at last_finished_at,
            latest.error_code last_error_code
       from public.connections connection
       left join public.meta_sync_schedules schedule
         on schedule.connection_id=connection.id
       left join lateral(
         select status,finished_at,error_code from public.meta_sync_runs run
          where run.connection_id=connection.id order by run.created_at desc limit 1
       ) latest on true
      where connection.project_id=$1 and connection.provider='meta_ads'`,
    [scope.project_id],
  )).rows;
  const metaScheduleByConnection = new Map(metaSchedules.map(item => [item.connection_id, item]));
  const metaRuns = (await database.pool.query<MetaRunRow>(
    `select ranked.id,ranked.connection_id,ranked.status,ranked.attempts,
            ranked.scheduled_for,ranked.started_at,ranked.finished_at,
            ranked.account_count,ranked.campaign_count,ranked.ad_set_count,
            ranked.ad_count,ranked.creative_count,ranked.insight_count,
            ranked.error_code,
            case when ranked.schedule_id is null then 'manual'
                 else 'scheduled' end mode
       from (
         select run.*,row_number() over(
           partition by run.connection_id order by run.created_at desc
         ) position
           from public.meta_sync_runs run where run.project_id=$1
       ) ranked
      where ranked.position<=5
      order by ranked.connection_id,ranked.created_at desc`,
    [scope.project_id],
  )).rows;
  const metaRunsByConnection = new Map<string, MetaRunRow[]>();
  for (const run of metaRuns) {
    const current = metaRunsByConnection.get(run.connection_id) ?? [];
    current.push(run); metaRunsByConnection.set(run.connection_id, current);
  }
  const metaCatalog = (
    await database.pool.query<MetaCatalogRow>(
      `select account.id as account_id,account.name as account_name,
              account.external_id as account_external_id,
              account.currency,account.currency_status,
              count(distinct campaign.id)::text as campaign_count,
              count(distinct ad_set.id)::text as ad_set_count,
              count(distinct ad.id)::text as ad_count,
              count(distinct ad.meta_creative_id)
                filter(where ad.meta_creative_id is not null)::text as creative_count,
              coalesce((select sum(insight.spend)
                          from public.meta_ad_insights_daily insight
                         where insight.meta_ad_account_id=account.id),0)::text as spend,
              coalesce((select sum(insight.impressions)
                          from public.meta_ad_insights_daily insight
                         where insight.meta_ad_account_id=account.id),0)::text as impressions,
              coalesce((select sum(insight.clicks)
                          from public.meta_ad_insights_daily insight
                         where insight.meta_ad_account_id=account.id),0)::text as clicks,
              (select max(insight.metric_date)::text
                 from public.meta_ad_insights_daily insight
                where insight.meta_ad_account_id=account.id) as last_insight_date,
              account.last_synced_at
         from public.meta_ad_accounts account
         left join public.meta_campaigns campaign
           on campaign.meta_ad_account_id=account.id
         left join public.meta_ad_sets ad_set
           on ad_set.meta_ad_account_id=account.id
         left join public.meta_ads ad on ad.meta_ad_account_id=account.id
        where account.project_id=$1
        group by account.id
        order by account.name`,
      [scope.project_id],
    )
  ).rows;

  const metaAuthorizations = (await database.pool.query<{ mode: string; status: string; token_expires_at: Date | null }>(
    `select mode::text as mode, status::text as status, token_expires_at
       from public.meta_authorizations where project_id=$1`,
    [scope.project_id],
  )).rows;
  const metaAuthExpired = metaAuthorizations.some((item) => item.status === "expired" || (item.mode === "oauth_user" && item.token_expires_at !== null && item.token_expires_at.getTime() < Date.now()));

  return (
    <PlatformShell eyebrow="Anúncios e catálogo" status={query.status} title="Meta Ads" vaultReady={vaultReady}>
      <p className="dashboard-context">Credenciais do aplicativo e do usuário do sistema, conexões do projeto, sincronização e catálogo autorizado.</p>
      {metaAuthExpired ? <div className="notice notice-error">A autorização da Meta expirou ou foi revogada e a sincronização parou. <Link href={`/dashboard/integracoes/meta/connect?projectId=${scope.project_id}`}>Reconectar com o Facebook</Link> para autorizar de novo e retomar a sincronização.</div> : null}
      <section className="integration-config-grid">
        <IntegrationForm provider="meta_ads_app" title="Meta OAuth" projectId={scope.project_id} current={metaAppConfig} disabled={!vaultReady || !canEdit} />
        <IntegrationForm provider="meta_ads" title="Meta · usuário do sistema" projectId={scope.project_id} current={metaSystemConfig} disabled={!vaultReady || !canEdit} />
      </section>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><p className="panel-label">Meta Ads</p><h2>Conexões do projeto</h2></div><span>{metaConnections.length} conexão(ões)</span></div>
        {metaConnections.length ? <div className="integration-config-grid">
          {metaConnections.map((connection) => {
            const mode = String(connection.configuration.authorizationMode ?? "system_user");
            const sync = metaSyncByConnection.get(connection.id);
            const schedule = metaScheduleByConnection.get(connection.id);
            const runs = metaRunsByConnection.get(connection.id) ?? [];
            return <article className="integration-config-card" key={connection.id}>
              <div><p className="panel-label">{connection.name}</p><span className="configured">{mode === "oauth_user" ? "OAuth do cliente" : "Usuário do sistema"}</span></div>
              <p>Estado: {String(connection.configuration.validationStatus ?? "aguardando validação")}</p>
              <p>Contas permitidas: {String(connection.configuration.adAccountAllowlist ?? "nenhuma")}</p>
              {sync ? <div className="integration-sync-summary">
                <strong>Última sincronização</strong>
                <span>{new Intl.DateTimeFormat("pt-BR", {
                  dateStyle: "short", timeStyle: "short",
                }).format(sync.occurred_at)}</span>
                <small>{Number(sync.details.accountCount ?? 0)} conta(s) · {Number(sync.details.campaignCount ?? 0)} campanha(s) · {Number(sync.details.adSetCount ?? 0)} conjunto(s)</small>
                <small>{Number(sync.details.adCount ?? 0)} anúncio(s) · {Number(sync.details.creativeCount ?? 0)} criativo(s) · {Number(sync.details.insightCount ?? 0)} insight(s)</small>
                <small>Janela: {Number(sync.details.insightWindowDays ?? 30)} dias · Graph API {String(sync.details.graphVersion ?? "não informada")}</small>
              </div> : <small>Nenhuma sincronização concluída registrada.</small>}
              <form action={updateMetaSyncSchedule} className="meta-schedule-form">
                <input name="project_id" type="hidden" value={scope.project_id} />
                <input name="connection_id" type="hidden" value={connection.id} />
                <label>Intervalo automático<select defaultValue={schedule?.interval_minutes ?? 360}
                  disabled={!canEdit} name="interval_minutes">
                  <option value="60">A cada 1 hora</option>
                  <option value="180">A cada 3 horas</option>
                  <option value="360">A cada 6 horas</option>
                  <option value="720">A cada 12 horas</option>
                  <option value="1440">Uma vez por dia</option>
                </select></label>
                <button disabled={!canEdit} name="enabled" type="submit"
                  value={schedule?.enabled ? "false" : "true"}>
                  {schedule?.enabled ? "Desativar sincronização automática" : "Ativar sincronização automática"}
                </button>
                <small>Estado: {schedule?.enabled ? "ativa" : "desativada"}
                  {schedule?.next_run_at ? ` · próxima ${new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short", timeStyle: "short",
                  }).format(schedule.next_run_at)}` : ""}</small>
                {schedule?.last_status ? <small>Última execução: {schedule.last_status}
                  {schedule.last_error_code ? ` · ${schedule.last_error_code}` : ""}</small> : null}
              </form>
              <form action={queueMetaSyncNow}>
                <input name="project_id" type="hidden" value={scope.project_id} />
                <input name="connection_id" type="hidden" value={connection.id} />
                <button disabled={!canEdit || ["running", "queued", "failed_retryable"]
                  .includes(schedule?.last_status ?? "")} type="submit">
                  {["running", "queued", "failed_retryable"].includes(schedule?.last_status ?? "")
                    ? "Sincronização em andamento" : "Sincronizar agora"}
                </button>
              </form>
              {runs.length ? <details className="meta-run-history">
                <summary>Ver últimas execuções ({runs.length})</summary>
                <div>{runs.map(run => <article key={run.id}>
                  <p><strong>{run.mode === "manual" ? "Manual" : "Agendada"}</strong>
                    <span>{run.status} · {run.attempts} tentativa(s)</span></p>
                  <small>{run.scheduled_for ? new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short", timeStyle: "short",
                  }).format(run.scheduled_for) : "Horário não informado"}</small>
                  {run.status === "completed" ? <small>{run.account_count} conta(s) · {run.campaign_count} campanha(s) · {run.ad_set_count} conjunto(s) · {run.ad_count} anúncio(s) · {run.creative_count} criativo(s) · {run.insight_count} insight(s)</small> : null}
                  {run.error_code ? <small className="run-error">{run.error_code}</small> : null}
                </article>)}</div>
              </details> : null}
              <form action={validateIntegrationConnection}>
                <input type="hidden" name="provider" value="meta_ads" />
                <input type="hidden" name="project_id" value={scope.project_id} />
                <input type="hidden" name="connection_id" value={connection.id} />
                <button disabled={!canEdit} type="submit">Validar e sincronizar esta conexão</button>
              </form>
              <form action={revokeMetaConnection}>
                <input type="hidden" name="project_id" value={scope.project_id} />
                <input type="hidden" name="connection_id" value={connection.id} />
                <button className="danger-button" disabled={!canEdit} type="submit">Revogar conexão</button>
              </form>
            </article>;
          })}
        </div> : <div className="empty-state"><strong>Nenhuma conexão Meta</strong><p>Configure um usuário do sistema ou conecte um cliente via OAuth.</p></div>}
      </section>
      <section className="dashboard-panel">
        <div className="panel-heading">
          <div><p className="panel-label">Meta Ads · somente leitura</p><h2>Catálogo autorizado</h2></div>
          <span>{metaCatalog.length} conta(s)</span>
        </div>
        {metaCatalog.length ? (
          <div className="table-shell">
            <table>
              <thead><tr><th>Conta</th><th>Moeda</th><th>Estrutura</th><th>Investimento original (30 dias)</th><th>Entrega</th><th>Última sincronização</th></tr></thead>
              <tbody>{metaCatalog.map((item) => (
                <tr key={item.account_external_id}>
                  <td><strong>{item.account_name}</strong><small>{item.account_external_id}</small></td>
                  <td><form action={correctMetaAccountCurrency} className="inline-filter-form">
                    <input name="project_id" type="hidden" value={scope.project_id} />
                    <input name="account_id" type="hidden" value={item.account_id} />
                    <select defaultValue={item.currency || ""} disabled={!canEdit} name="currency" required>
                      <option disabled value="">Confirmar moeda</option><option value="BRL">BRL</option>
                      <option value="USD">USD</option><option value="EUR">EUR</option>
                    </select><button disabled={!canEdit} type="submit">Confirmar</button>
                    <small>{item.currency_status}</small>
                  </form></td>
                  <td>{item.campaign_count} campanha(s)<small>{item.ad_set_count} conjuntos · {item.ad_count} anúncios · {item.creative_count} criativos</small></td>
                  <td>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: item.currency || "BRL" }).format(Number(item.spend))}</td>
                  <td>{Number(item.impressions).toLocaleString("pt-BR")} impressões<small>{Number(item.clicks).toLocaleString("pt-BR")} cliques · até {item.last_insight_date ?? "sem insights"}</small></td>
                  <td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(item.last_synced_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state"><strong>Nenhum catálogo sincronizado</strong><p>Salve a credencial, informe a allowlist e use “Validar token e sincronizar”.</p></div>}
      </section>
    </PlatformShell>
  );
}
