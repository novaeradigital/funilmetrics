import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { loadIntegrationVaultKey } from "../../../lib/integration-vault";
import { createClient } from "../../../lib/supabase/server";
import {
  saveIntegrationConfiguration,
  validateIntegrationConnection,
  revokeMetaConnection,
  updateOpenAiBudget,
  saveAiPricing,
  updateMetaSyncSchedule,
  queueMetaSyncNow,
  correctMetaAccountCurrency,
} from "./actions";
import {getActiveProject} from "../../../lib/active-project";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {CREATIVE_MEDIA_POLICY_V1} from "@funil-metrics/domain";

export const dynamic = "force-dynamic";

type Scope = { project_id: string; project_name: string; role: string };
type Configured = {
  id: string;
  name: string;
  provider: string;
  configuration: Record<string, string | number>;
  has_secret: boolean;
  updated_at: Date;
};
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
type MetaSyncRow={connection_id:string;occurred_at:Date;details:Record<string,unknown>};
type MetaScheduleRow={connection_id:string;enabled:boolean;interval_minutes:number;
  next_run_at:Date|null;last_run_at:Date|null;last_status:string|null;
  last_finished_at:Date|null;last_error_code:string|null};
type MetaRunRow={id:string;connection_id:string;status:string;attempts:number;
  scheduled_for:Date|null;started_at:Date|null;finished_at:Date|null;
  account_count:number;campaign_count:number;ad_set_count:number;ad_count:number;
  creative_count:number;insight_count:number;error_code:string|null;
  mode:"manual"|"scheduled"};
type AiUsageSummary={jobs:string;input_tokens:string;output_tokens:string;estimated_cost_brl:string|null};
type AiPricing={id:string;model:string;operation:string;input_cost_per_million_brl:string|null;output_cost_per_million_brl:string|null;audio_cost_per_minute_brl:string|null;source_reference:string|null;valid_from:Date};

const integrationErrorMessages:Record<string,string>={
  forbidden:"A ação não pertence ao projeto ativo ou seu perfil não tem permissão.",
  "meta-oauth-denied":"A autorização da Meta foi cancelada ou recusada.",
  "meta-oauth-invalid":"A autorização da Meta expirou ou já foi utilizada. Inicie novamente.",
  "meta-app-not-configured":"As credenciais do aplicativo Meta estão incompletas neste projeto.",
  "meta-oauth-exchange-unavailable":"A Meta não respondeu a tempo. Inicie uma nova conexão.",
  "meta-oauth-exchange-failed":"A Meta recusou a troca do código de autorização.",
  "meta-oauth-exchange-invalid":"A Meta devolveu uma resposta de autorização inválida.",
  "meta-oauth-profile-unavailable":"A Meta não respondeu ao consultar o perfil autorizado.",
  "meta-oauth-profile-failed":"Não foi possível validar o perfil autorizado na Meta.",
  "meta-oauth-profile-invalid":"A Meta devolveu dados de perfil inválidos.",
  "meta-oauth-save-failed":"A autorização foi validada, mas não pôde ser salva com segurança.",
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database = getDatabase();
  const scope = (
    await database.pool.query<Scope>(
      `select project.id as project_id, project.name as project_name,
              coalesce(allowed.role_override, membership.role)::text as role
         from public.projects project
         join public.users app_user on app_user.auth_user_id = $1
         join public.memberships membership
           on membership.organization_id = project.organization_id
          and membership.user_id = app_user.id
         left join public.project_memberships allowed
           on allowed.membership_id = membership.id
          and allowed.project_id = project.id
        where app_user.status = 'active' and project.id=$2
          and (
            not exists (
              select 1
                from public.project_memberships restricted
               where restricted.membership_id = membership.id
            )
            or allowed.project_id is not null
          )
        order by project.created_at limit 1`,
      [data.user.id,active.project.id],
    )
  ).rows[0];
  if (!scope) redirect("/dashboard");
  const configured = (
    await database.pool.query<Configured>(
      `select connection.id, connection.name, connection.provider, connection.configuration,
              exists (select 1 from public.integration_secrets secret
                where secret.project_id = connection.project_id
                  and secret.provider = connection.provider
                  and secret.kind = 'credential_bundle'
                  and secret.rotated_at is null) as has_secret,
              connection.updated_at
         from public.connections connection
        where connection.project_id = $1
          and connection.provider in (
            'google_drive_app', 'openai', 'cloudflare_r2', 'clamav', 'meta_ads',
            'meta_ads_app'
            , 'railway', 'cloudflare_account'
          )`,
      [scope.project_id],
    )
  ).rows;
  const byProvider = new Map(configured.map((item) => [item.provider, item]));
  const lastlinkSummary=(await database.pool.query<{total:number;active:number;last_event_at:Date|null}>(
    `select count(distinct connection.id)::int total,
            count(distinct connection.id) filter(where connection.status='active')::int active,
            max(event.received_at) last_event_at
       from public.connections connection
       left join public.raw_events event on event.connection_id=connection.id
      where connection.organization_id=$1 and connection.project_id=$2
        and connection.provider='lastlink'`,
    [active.project.organization_id,scope.project_id],
  )).rows[0]??{total:0,active:0,last_event_at:null};
  const configCheckoutSummary=(await database.pool.query<{total:number;active:number;last_event_at:Date|null}>(
    `select count(distinct connection.id)::int total,
            count(distinct connection.id) filter(where connection.status='active')::int active,
            max(event.received_at) last_event_at
       from public.connections connection
       left join public.raw_events event on event.connection_id=connection.id
      where connection.organization_id=$1 and connection.project_id=$2
        and connection.provider='configcheckout'`,
    [active.project.organization_id,scope.project_id],
  )).rows[0]??{total:0,active:0,last_event_at:null};
  const metaConnections = configured.filter((item)=>item.provider==="meta_ads");
  const metaSystemConfig = metaConnections.find((item)=>
    String(item.configuration.authorizationMode??"system_user")==="system_user" &&
    item.has_secret);
  const metaAppConfig = byProvider.get("meta_ads_app") ?? metaSystemConfig;
  const metaSyncRows=(await database.pool.query<MetaSyncRow>(
    `select distinct on (target_id) target_id connection_id,occurred_at,
            coalesce(after,'{}'::jsonb) details
       from public.audit_logs
      where project_id=$1 and action='meta_catalog_synchronized'
      order by target_id,occurred_at desc`,
    [scope.project_id],
  )).rows;
  const metaSyncByConnection=new Map(metaSyncRows.map((item)=>[item.connection_id,item]));
  const metaSchedules=(await database.pool.query<MetaScheduleRow>(
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
  const metaScheduleByConnection=new Map(metaSchedules.map(item=>[item.connection_id,item]));
  const metaRuns=(await database.pool.query<MetaRunRow>(
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
  const metaRunsByConnection=new Map<string,MetaRunRow[]>();
  for(const run of metaRuns){
    const current=metaRunsByConnection.get(run.connection_id)??[];
    current.push(run);metaRunsByConnection.set(run.connection_id,current);
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
  const aiUsage=(
    await database.pool.query<AiUsageSummary>(
      `select count(*)::text jobs,coalesce(sum(input_tokens),0)::text input_tokens,
       coalesce(sum(output_tokens),0)::text output_tokens,
       sum(estimated_cost_brl)::text estimated_cost_brl
       from public.ai_usage_records where project_id=$1
       and measured_at>=date_trunc('month',now())`,
      [scope.project_id],
    )
  ).rows[0];
  const aiPricing=(await database.pool.query<AiPricing>(
    `select id,model,operation,input_cost_per_million_brl,
      output_cost_per_million_brl,audio_cost_per_minute_brl,
      source_reference,valid_from
      from public.ai_project_pricing_versions
      where project_id=$1 and valid_until is null order by operation,model`,
    [scope.project_id])).rows;
  let vaultReady = false;
  try { vaultReady = Boolean(loadIntegrationVaultKey()); } catch { vaultReady = false; }
  const canEdit = ["owner", "administrator"].includes(scope.role);

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/integracoes" footerLabel="Credenciais protegidas" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/integracoes" statusLabel="Cofre ativo"/>
        <div className="dashboard-main">
          <header className="dashboard-titlebar"><div><p className="eyebrow">Credenciais e serviços</p><h1>Integrações</h1><p className="dashboard-context">Configure serviços externos sem expor chaves em telas ou logs.</p></div></header>
          {query.status === "saved" ? <div className="notice notice-success">Configuração salva no cofre e registrada na auditoria.</div> : null}
          {query.status === "r2-valid" ? <div className="notice notice-success">Conexão com o bucket R2 validada com sucesso.</div> : null}
          {query.status === "clamav-valid" ? <div className="notice notice-success">Conexão privada com o ClamAV validada com sucesso.</div> : null}
          {query.status === "meta_ads-valid" ? <div className="notice notice-success">Token Meta e contas permitidas validados em modo de leitura.</div> : null}
          {query.status === "railway-valid" ? <div className="notice notice-success">Acesso à Railway validado para provisionamento de domínios.</div> : null}
          {query.status === "meta-schedule-enabled" ? <div className="notice notice-success">Sincronização automática Meta ativada para esta conexão.</div> : null}
          {query.status === "meta-schedule-disabled" ? <div className="notice notice-success">Sincronização automática Meta desativada.</div> : null}
          {query.status === "meta-sync-queued" ? <div className="notice notice-success">Sincronização Meta adicionada à fila do worker.</div> : null}
          {query.status === "meta-oauth-connected" ? <div className="notice notice-success">Conta Meta conectada e contas de anúncios autorizadas. Execute a primeira sincronização para importar os dados.</div> : null}
          {query.status === "budget-saved" ? <div className="notice notice-success">Limite mensal de IA atualizado e registrado na auditoria.</div> : null}
          {query.status === "pricing-saved" ? <div className="notice notice-success">Nova versão de preço de IA registrada.</div> : null}
          {query.status && !["saved", "r2-valid", "clamav-valid", "meta_ads-valid", "railway-valid", "budget-saved", "pricing-saved", "meta-schedule-enabled", "meta-schedule-disabled", "meta-sync-queued", "meta-oauth-connected"].includes(query.status) ? <div className="notice notice-error">{integrationErrorMessages[query.status]??`Não foi possível concluir: ${query.status.replaceAll("-", " ")}.`}</div> : null}
          {!vaultReady ? <div className="notice notice-error">O cofre central ainda não possui chave de criptografia no servidor. Os campos permanecem bloqueados.</div> : null}
          <section className="integration-entry-grid" aria-label="Integrações operacionais">
            <article className="integration-entry-card">
              <div><span className={lastlinkSummary.active?"status-dot":"status-dot is-muted"}/>
                <p><small>Vendas e pagamentos</small><strong>Lastlink</strong></p></div>
              <p>{lastlinkSummary.total
                ? `${lastlinkSummary.active} de ${lastlinkSummary.total} produto(s) conectado(s)`
                : "Nenhum produto conectado neste projeto."}</p>
              <small>{lastlinkSummary.last_event_at
                ? `Último evento em ${new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",
                    timeZone:active.project.timezone}).format(lastlinkSummary.last_event_at)}`
                : "Cada produto pode receber uma URL e um token próprios."}</small>
              <Link className="secondary-button" href="/dashboard/integracoes/lastlink">
                {lastlinkSummary.total?"Gerenciar produtos":"Conectar produto"}
              </Link>
            </article>
            <article className="integration-entry-card">
              <div><span className={configCheckoutSummary.active?"status-dot":"status-dot is-muted"}/>
                <p><small>Vendas e pagamentos</small><strong>ConfigCheckout</strong></p></div>
              <p>{configCheckoutSummary.total
                ? `${configCheckoutSummary.active} de ${configCheckoutSummary.total} vendedor(es) conectado(s)`
                : "Nenhum vendedor conectado neste projeto."}</p>
              <small>{configCheckoutSummary.last_event_at
                ? `Último evento em ${new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short",
                    timeZone:active.project.timezone}).format(configCheckoutSummary.last_event_at)}`
                : "Cada vendedor recebe uma URL e um token próprios."}</small>
              <Link className="secondary-button" href="/dashboard/integracoes/configcheckout">
                {configCheckoutSummary.total?"Gerenciar vendedores":"Conectar vendedor"}
              </Link>
            </article>
          </section>
          <section className="integration-config-grid">
            <IntegrationForm provider="google_drive_app" title="Google Drive" projectId={scope.project_id} current={byProvider.get("google_drive_app")} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="openai" title="OpenAI" projectId={scope.project_id} current={byProvider.get("openai")} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="meta_ads_app" title="Meta OAuth" projectId={scope.project_id} current={metaAppConfig} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="meta_ads" title="Meta · usuário do sistema" projectId={scope.project_id} current={metaSystemConfig} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="cloudflare_r2" title="Cloudflare R2" projectId={scope.project_id} current={byProvider.get("cloudflare_r2")} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="clamav" title="ClamAV" projectId={scope.project_id} current={byProvider.get("clamav")} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="railway" title="Railway · domínios" projectId={scope.project_id} current={byProvider.get("railway")} disabled={!vaultReady || !canEdit} />
            <IntegrationForm provider="cloudflare_account" title="Cloudflare · domínios próprios" projectId={scope.project_id} current={byProvider.get("cloudflare_account")} disabled={!vaultReady || !canEdit} />
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><p className="panel-label">Central de Criativos</p>
              <h2>Política efetiva de mídia</h2></div><span>{CREATIVE_MEDIA_POLICY_V1.version}</span></div>
            <p className="dashboard-context">Limites aplicados pelo worker. Esta visão é somente leitura e não altera importações.</p>
            <p className="dashboard-context">
              Por execução: até {CREATIVE_MEDIA_POLICY_V1.execution.maxFiles.toLocaleString("pt-BR")} arquivos e{" "}
              {CREATIVE_MEDIA_POLICY_V1.execution.maxBytes/1024**3} GB.
            </p>
            <div className="table-shell"><table><thead><tr><th>MIME type</th><th>Limite</th><th>Tratamento</th></tr></thead>
              <tbody>{Object.entries(CREATIVE_MEDIA_POLICY_V1.formats).map(([mime,rule])=><tr key={mime}>
                <td>{mime}</td><td>{rule.maxBytes>=1024**3?`${rule.maxBytes/1024**3} GB`:`${rule.maxBytes/1024**2} MB`}</td>
                <td>{"export" in rule?"Exportação oficial para DOCX":"Cópia binária por streaming"}</td>
              </tr>)}</tbody></table></div>
            <small>Arquivos fora da lista são rejeitados. A importação continua sujeita à varredura antimalware e ao limite do scanner configurado no projeto.</small>
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><p className="panel-label">OpenAI · preços em BRL</p><h2>Precificação versionada</h2></div><span>{aiPricing.length} preço(s) ativo(s)</span></div>
            <div className="integration-config-grid">
              {(["creative_analysis","creative_transcription"] as const).map((operation)=>{
                const openai=byProvider.get("openai");
                const model=String(operation==="creative_analysis"
                  ? openai?.configuration.analysisModel??""
                  : openai?.configuration.transcriptionModel??"");
                const current=aiPricing.find((item)=>item.operation===operation&&item.model===model);
                return <form action={saveAiPricing} className="integration-config-card" key={operation}>
                  <input name="project_id" type="hidden" value={scope.project_id}/>
                  <input name="operation" type="hidden" value={operation}/>
                  <label>Operação<input readOnly value={operation==="creative_analysis"?"Análise de criativo":"Transcrição"}/></label>
                  <label>Modelo<input name="model" readOnly value={model}/></label>
                  {operation==="creative_analysis"?<>
                    <label>Entrada por 1 milhão de tokens (R$)<input defaultValue={current?.input_cost_per_million_brl??""} min="0" name="input_cost_per_million_brl" step="0.00000001" type="number"/></label>
                    <label>Saída por 1 milhão de tokens (R$)<input defaultValue={current?.output_cost_per_million_brl??""} min="0" name="output_cost_per_million_brl" step="0.00000001" type="number"/></label>
                  </>:<label>Áudio por minuto (R$)<input defaultValue={current?.audio_cost_per_minute_brl??""} min="0" name="audio_cost_per_minute_brl" step="0.00000001" type="number"/></label>}
                  <label>Fonte do preço<input defaultValue={current?.source_reference??""} name="source_reference" placeholder="URL ou referência da tabela utilizada"/></label>
                  <small>{current?`Versão ativa desde ${new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(current.valid_from)}`:"Preço ainda não informado. O uso permanece medido, com custo desconhecido."}</small>
                  <button disabled={!canEdit||!model} type="submit">Criar nova versão</button>
                </form>;
              })}
            </div>
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><p className="panel-label">Meta Ads</p><h2>Conexões do projeto</h2></div><span>{metaConnections.length} conexão(ões)</span></div>
            {metaConnections.length ? <div className="integration-config-grid">
              {metaConnections.map((connection)=>{
                 const mode=String(connection.configuration.authorizationMode??"system_user");
                 const sync=metaSyncByConnection.get(connection.id);
                 const schedule=metaScheduleByConnection.get(connection.id);
                 const runs=metaRunsByConnection.get(connection.id)??[];
                return <article className="integration-config-card" key={connection.id}>
                  <div><p className="panel-label">{connection.name}</p><span className="configured">{mode==="oauth_user"?"OAuth do cliente":"Usuário do sistema"}</span></div>
                   <p>Estado: {String(connection.configuration.validationStatus??"aguardando validação")}</p>
                   <p>Contas permitidas: {String(connection.configuration.adAccountAllowlist??"nenhuma")}</p>
                   {sync?<div className="integration-sync-summary">
                     <strong>Última sincronização</strong>
                     <span>{new Intl.DateTimeFormat("pt-BR",{
                       dateStyle:"short",timeStyle:"short",
                     }).format(sync.occurred_at)}</span>
                     <small>{Number(sync.details.accountCount??0)} conta(s) · {Number(sync.details.campaignCount??0)} campanha(s) · {Number(sync.details.adSetCount??0)} conjunto(s)</small>
                     <small>{Number(sync.details.adCount??0)} anúncio(s) · {Number(sync.details.creativeCount??0)} criativo(s) · {Number(sync.details.insightCount??0)} insight(s)</small>
                     <small>Janela: {Number(sync.details.insightWindowDays??30)} dias · Graph API {String(sync.details.graphVersion??"não informada")}</small>
                   </div>:<small>Nenhuma sincronização concluída registrada.</small>}
                   <form action={updateMetaSyncSchedule} className="meta-schedule-form">
                     <input name="project_id" type="hidden" value={scope.project_id}/>
                     <input name="connection_id" type="hidden" value={connection.id}/>
                     <label>Intervalo automático<select defaultValue={schedule?.interval_minutes??360}
                       disabled={!canEdit} name="interval_minutes">
                       <option value="60">A cada 1 hora</option>
                       <option value="180">A cada 3 horas</option>
                       <option value="360">A cada 6 horas</option>
                       <option value="720">A cada 12 horas</option>
                       <option value="1440">Uma vez por dia</option>
                     </select></label>
                     <button disabled={!canEdit} name="enabled" type="submit"
                       value={schedule?.enabled?"false":"true"}>
                       {schedule?.enabled?"Desativar sincronização automática":"Ativar sincronização automática"}
                     </button>
                     <small>Estado: {schedule?.enabled?"ativa":"desativada"}
                       {schedule?.next_run_at?` · próxima ${new Intl.DateTimeFormat("pt-BR",{
                         dateStyle:"short",timeStyle:"short",
                       }).format(schedule.next_run_at)}`:""}</small>
                     {schedule?.last_status?<small>Última execução: {schedule.last_status}
                       {schedule.last_error_code?` · ${schedule.last_error_code}`:""}</small>:null}
                   </form>
                   <form action={queueMetaSyncNow}>
                     <input name="project_id" type="hidden" value={scope.project_id}/>
                     <input name="connection_id" type="hidden" value={connection.id}/>
                     <button disabled={!canEdit||["running","queued","failed_retryable"]
                       .includes(schedule?.last_status??"")} type="submit">
                       {["running","queued","failed_retryable"].includes(schedule?.last_status??"")
                         ?"Sincronização em andamento":"Sincronizar agora"}
                     </button>
                   </form>
                   {runs.length?<details className="meta-run-history">
                     <summary>Ver últimas execuções ({runs.length})</summary>
                     <div>{runs.map(run=><article key={run.id}>
                       <p><strong>{run.mode==="manual"?"Manual":"Agendada"}</strong>
                         <span>{run.status} · {run.attempts} tentativa(s)</span></p>
                       <small>{run.scheduled_for?new Intl.DateTimeFormat("pt-BR",{
                         dateStyle:"short",timeStyle:"short",
                       }).format(run.scheduled_for):"Horário não informado"}</small>
                       {run.status==="completed"?<small>{run.account_count} conta(s) · {run.campaign_count} campanha(s) · {run.ad_set_count} conjunto(s) · {run.ad_count} anúncio(s) · {run.creative_count} criativo(s) · {run.insight_count} insight(s)</small>:null}
                       {run.error_code?<small className="run-error">{run.error_code}</small>:null}
                     </article>)}</div>
                   </details>:null}
                   <form action={validateIntegrationConnection}>
                    <input type="hidden" name="provider" value="meta_ads"/>
                    <input type="hidden" name="project_id" value={scope.project_id}/>
                    <input type="hidden" name="connection_id" value={connection.id}/>
                    <button disabled={!canEdit} type="submit">Validar e sincronizar esta conexão</button>
                  </form>
                  <form action={revokeMetaConnection}>
                    <input type="hidden" name="project_id" value={scope.project_id}/>
                    <input type="hidden" name="connection_id" value={connection.id}/>
                    <button className="danger-button" disabled={!canEdit} type="submit">Revogar conexão</button>
                  </form>
                </article>;
              })}
            </div> : <div className="empty-state"><strong>Nenhuma conexão Meta</strong><p>Configure um usuário do sistema ou conecte um cliente via OAuth.</p></div>}
          </section>
          <section className="dashboard-panel">
            <div className="panel-heading"><div><p className="panel-label">OpenAI · mês atual</p><h2>Uso medido</h2></div></div>
            <div className="creative-foundation-grid">
              <article><span>Execuções medidas</span><strong>{aiUsage?.jobs??"0"}</strong></article>
              <article><span>Tokens de entrada</span><strong>{aiUsage?.input_tokens??"0"}</strong></article>
              <article><span>Tokens de saída</span><strong>{aiUsage?.output_tokens??"0"}</strong></article>
              <article><span>Custo estimado</span><strong>{aiUsage?.estimated_cost_brl?`R$ ${aiUsage.estimated_cost_brl}`:"Preço não configurado"}</strong></article>
            </div>
            {!aiUsage?.estimated_cost_brl?<small>O sistema não apresenta custo zero: falta uma tabela de preços válida para converter o uso medido.</small>:null}
            {byProvider.get("openai") ? (
              <form action={updateOpenAiBudget} className="inline-filter-form">
                <input name="project_id" type="hidden" value={scope.project_id} />
                <label>Limite mensal operacional (R$)
                  <input
                    defaultValue={String(byProvider.get("openai")?.configuration.monthlyBudgetBrl ?? "100")}
                    disabled={!canEdit}
                    min="1"
                    name="monthly_budget_brl"
                    step="1"
                    type="number"
                  />
                </label>
                <button disabled={!canEdit} type="submit">Atualizar limite</button>
              </form>
            ) : null}
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
                        <input name="project_id" type="hidden" value={scope.project_id}/>
                        <input name="account_id" type="hidden" value={item.account_id}/>
                        <select defaultValue={item.currency||""} disabled={!canEdit} name="currency" required>
                          <option disabled value="">Confirmar moeda</option><option value="BRL">BRL</option>
                          <option value="USD">USD</option><option value="EUR">EUR</option>
                        </select><button disabled={!canEdit} type="submit">Confirmar</button>
                        <small>{item.currency_status}</small>
                      </form></td>
                      <td>{item.campaign_count} campanha(s)<small>{item.ad_set_count} conjuntos · {item.ad_count} anúncios · {item.creative_count} criativos</small></td>
                      <td>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:item.currency||"BRL"}).format(Number(item.spend))}</td>
                      <td>{Number(item.impressions).toLocaleString("pt-BR")} impressões<small>{Number(item.clicks).toLocaleString("pt-BR")} cliques · até {item.last_insight_date??"sem insights"}</small></td>
                      <td>{new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(item.last_synced_at)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="empty-state"><strong>Nenhum catálogo sincronizado</strong><p>Salve a credencial, informe a allowlist e use “Validar token e sincronizar”.</p></div>}
          </section>
        </div>
      </section>
    </main>
  );
}

function IntegrationForm({ provider, title, projectId, current, disabled }: {
  provider: "google_drive_app" | "openai" | "cloudflare_r2" | "clamav" | "meta_ads" | "meta_ads_app" | "railway" | "cloudflare_account"; title: string; projectId: string;
  current?: Configured; disabled: boolean;
}) {
  const config = current?.configuration ?? {};
  const canValidate = ["cloudflare_r2", "clamav", "meta_ads", "railway","cloudflare_account"].includes(provider);
  const validationStatus = String(config.validationStatus ?? "");
  const validationLabel = !current
    ? "Pendente"
    : !canValidate
      ? "Credencial salva"
      : validationStatus === "valid"
        ? "Validada"
        : validationStatus === "invalid"
          ? "Inválida"
          : "Salva · não validada";
  const validationTimestamp =
    validationStatus === "valid"
      ? config.lastValidatedAt
      : validationStatus === "invalid"
        ? config.lastValidationFailedAt
        : null;
  const parsedValidationTimestamp = validationTimestamp
    ? new Date(String(validationTimestamp))
    : null;
  return (
    <form action={saveIntegrationConfiguration} className="integration-config-card">
      <input name="provider" type="hidden" value={provider} /><input name="project_id" type="hidden" value={projectId} />
      <div><p className="panel-label">{title}</p><span className={validationStatus === "invalid" ? "invalid" : current ? "configured" : ""}>{validationLabel}</span></div>
      {provider === "google_drive_app" ? <>
        <label>Client ID<input disabled={disabled} name="client_id" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "....apps.googleusercontent.com"} type="password" /></label>
        <label>Client Secret<input disabled={disabled} name="client_secret" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Segredo OAuth"} type="password" /></label>
        <label>Chave do Google Picker<input disabled={disabled} name="picker_api_key" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Chave de API"} type="password" /></label>
        <label>Número do projeto Google Cloud<input defaultValue={String(config.projectNumber ?? "317868680348")} disabled={disabled} name="project_number" inputMode="numeric" /></label>
        <small>Redirect URI: https://web-production-a818d.up.railway.app/dashboard/integracoes/google-drive/callback</small>
      </> : provider === "meta_ads_app" ? <>
        <label>App ID<input defaultValue={String(config.appId ?? "")} disabled={disabled} name="app_id" inputMode="numeric" /></label>
        <label>App Secret<input disabled={disabled} name="app_secret" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Segredo do app Meta"} type="password" /></label>
        <small>Redirect URI: https://web-production-a818d.up.railway.app/dashboard/integracoes/meta/callback</small>
        <small>Escopos de leitura: ads_read e business_management.</small>
        {current?.has_secret ? <Link className="secondary-button" href={`/dashboard/integracoes/meta/connect?projectId=${projectId}`}>Conectar conta via OAuth</Link> : null}
      </> : provider === "meta_ads" ? <>
        <label>Token de acesso do sistema<input disabled={disabled} name="access_token" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Token da Meta"} type="password" /></label>
        <label>App Secret<input disabled={disabled} name="app_secret" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Segredo do app Meta"} type="password" /></label>
        <label>App ID<input defaultValue={String(config.appId ?? "")} disabled={disabled} name="app_id" inputMode="numeric" /></label>
        <label>Business ID<input defaultValue={String(config.businessId ?? "")} disabled={disabled} name="business_id" inputMode="numeric" /></label>
        <label>Contas de anúncio permitidas<input defaultValue={String(config.adAccountAllowlist ?? "")} disabled={disabled} name="ad_account_allowlist" placeholder="act_123, act_456" /></label>
        <small>Modo inicial: preparação e prévia. Nenhum anúncio será enviado apenas ao salvar a credencial.</small>
      </> : provider === "openai" ? <>
        <label>Chave da API<input disabled={disabled} name="api_key" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "sk-..."} type="password" /></label>
        <label>Modelo de análise<input defaultValue={String(config.analysisModel ?? "gpt-5.6-luna")} disabled={disabled} name="analysis_model" /></label>
        <label>Modelo de transcrição<input defaultValue={String(config.transcriptionModel ?? "gpt-4o-transcribe")} disabled={disabled} name="transcription_model" /></label>
        <label>Limite mensal (R$)<input defaultValue={String(config.monthlyBudgetBrl ?? "100")} disabled={disabled} min="1" name="monthly_budget_brl" type="number" /></label>
      </> : provider === "cloudflare_r2" ? <>
        <label>Account ID<input defaultValue={String(config.accountId ?? "")} disabled={disabled} name="account_id" /></label>
        <label>Bucket privado<input defaultValue={String(config.bucket ?? "")} disabled={disabled} name="bucket" /></label>
        <label>Access Key ID<input disabled={disabled} name="access_key_id" type="password" /></label>
        <label>Secret Access Key<input disabled={disabled} name="secret_access_key" type="password" /></label>
      </> : provider === "cloudflare_account" ? <>
        <label>Account ID<input defaultValue={String(config.accountId ?? "")} disabled={disabled} name="account_id" /></label>
        <label>API Token<input disabled={disabled} name="api_token" type="password" placeholder="Token com Zone Edit e DNS Edit" /></label>
        <small>O token fica criptografado e limitado ao projeto. Nunca será exibido novamente.</small>
      </> : provider === "railway" ? <>
        <label>Token da API<input disabled={disabled} name="api_token" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Token Railway"} type="password" /></label>
        <label>Project ID<input defaultValue={String(config.projectId ?? "")} disabled={disabled} name="railway_project_id" /></label>
        <label>Environment ID<input defaultValue={String(config.environmentId ?? "")} disabled={disabled} name="railway_environment_id" /></label>
        <label>Web Service ID<input defaultValue={String(config.serviceId ?? "")} disabled={disabled} name="railway_service_id" /></label>
        <small>Use um token com acesso apenas ao projeto de produção. O provisionamento cria o hostname, mas nunca altera o DNS do seu domínio.</small>
      </> : <>
        <label>Host interno<input defaultValue={String(config.host ?? "")} disabled={disabled} name="host" /></label>
        <label>Porta<input defaultValue={String(config.port ?? "3310")} disabled={disabled} name="port" type="number" /></label>
      </>}
      <small>Segredos não poderão ser visualizados depois de salvos. A ativação operacional é validada separadamente.</small>
      {parsedValidationTimestamp &&
      !Number.isNaN(parsedValidationTimestamp.getTime()) ? (
        <small>
          {validationStatus === "valid" ? "Última validação" : "Última falha"}:{" "}
          {parsedValidationTimestamp.toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
          })}
        </small>
      ) : null}
      <button disabled={disabled} type="submit">Salvar configuração</button>
      {(provider === "cloudflare_r2" && current?.has_secret) ||
      (provider === "clamav" && current) ||
      (provider === "meta_ads" && current?.has_secret) ||
      (provider === "railway" && current?.has_secret) ||
      (provider === "cloudflare_account" && current?.has_secret) ? (
        <button
          className="secondary-button"
          disabled={disabled}
          formAction={validateIntegrationConnection}
          type="submit"
        >
          {provider === "cloudflare_r2"
            ? "Testar conexão com o bucket"
            : provider === "meta_ads"
              ? "Validar token e sincronizar"
              : provider === "railway"
                ? "Validar acesso à Railway"
              : "Testar conexão privada"}
        </button>
      ) : null}
    </form>
  );
}
