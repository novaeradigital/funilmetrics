import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getDatabase } from "../../../lib/database";
import { loadIntegrationVaultKey } from "../../../lib/integration-vault";
import { createClient } from "../../../lib/supabase/server";
import { getActiveProject } from "../../../lib/active-project";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import {
  saveIntegrationConfiguration,
  validateIntegrationConnection,
} from "./actions";

export type Scope = { project_id: string; project_name: string; role: string };
export type Configured = {
  id: string;
  name: string;
  provider: string;
  configuration: Record<string, string | number>;
  has_secret: boolean;
  updated_at: Date;
};
export type IntegrationProvider =
  | "google_drive_app"
  | "openai"
  | "cloudflare_r2"
  | "clamav"
  | "meta_ads"
  | "meta_ads_app"
  | "railway"
  | "cloudflare_account";

export const integrationErrorMessages: Record<string, string> = {
  forbidden: "A ação não pertence ao projeto ativo ou seu perfil não tem permissão.",
  "meta-oauth-denied": "A autorização da Meta foi cancelada ou recusada.",
  "meta-oauth-invalid": "A autorização da Meta expirou ou já foi utilizada. Inicie novamente.",
  "meta-app-not-configured": "As credenciais do aplicativo Meta estão incompletas neste projeto.",
  "meta-oauth-exchange-unavailable": "A Meta não respondeu a tempo. Inicie uma nova conexão.",
  "meta-oauth-exchange-failed": "A Meta recusou a troca do código de autorização.",
  "meta-oauth-exchange-invalid": "A Meta devolveu uma resposta de autorização inválida.",
  "meta-oauth-profile-unavailable": "A Meta não respondeu ao consultar o perfil autorizado.",
  "meta-oauth-profile-failed": "Não foi possível validar o perfil autorizado na Meta.",
  "meta-oauth-profile-invalid": "A Meta devolveu dados de perfil inválidos.",
  "meta-oauth-save-failed": "A autorização foi validada, mas não pôde ser salva com segurança.",
};

export const integrationSuccessMessages: Record<string, string> = {
  saved: "Configuração salva no cofre e registrada na auditoria.",
  "r2-valid": "Conexão com o bucket R2 validada com sucesso.",
  "clamav-valid": "Conexão privada com o ClamAV validada com sucesso.",
  "meta_ads-valid": "Token Meta e contas permitidas validados em modo de leitura.",
  "railway-valid": "Acesso à Railway validado para provisionamento de domínios.",
  "meta-schedule-enabled": "Sincronização automática Meta ativada para esta conexão.",
  "meta-schedule-disabled": "Sincronização automática Meta desativada.",
  "meta-sync-queued": "Sincronização Meta adicionada à fila do worker.",
  "meta-oauth-connected": "Conta Meta conectada e contas de anúncios autorizadas. Execute a primeira sincronização para importar os dados.",
  "meta-revoked": "Conexão Meta revogada.",
  "currency-correction-saved": "Moeda da conta confirmada.",
  "budget-saved": "Limite mensal de IA atualizado e registrado na auditoria.",
  "pricing-saved": "Nova versão de preço de IA registrada.",
};

export function IntegrationNotices({ status }: { status?: string }) {
  if (!status) return null;
  if (integrationSuccessMessages[status]) {
    return <div className="notice notice-success">{integrationSuccessMessages[status]}</div>;
  }
  return (
    <div className="notice notice-error">
      {integrationErrorMessages[status] ?? `Não foi possível concluir: ${status.replaceAll("-", " ")}.`}
    </div>
  );
}

export async function loadIntegrationContext() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const active = await getActiveProject(data.user.id);
  if (!active.project) redirect("/dashboard/projetos");
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
      [data.user.id, active.project.id],
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
            'meta_ads_app', 'railway', 'cloudflare_account'
          )`,
      [scope.project_id],
    )
  ).rows;
  const byProvider = new Map(configured.map((item) => [item.provider, item]));
  let vaultReady = false;
  try { vaultReady = Boolean(loadIntegrationVaultKey()); } catch { vaultReady = false; }
  const canEdit = ["owner", "administrator"].includes(scope.role);
  return {
    active,
    scope,
    configured,
    byProvider,
    canEdit,
    vaultReady,
    organizationId: active.project.organization_id,
    timezone: active.project.timezone,
  };
}

export function PlatformShell({
  title,
  eyebrow,
  status,
  vaultReady,
  children,
}: {
  title: string;
  eyebrow: string;
  status?: string;
  vaultReady: boolean;
  children: ReactNode;
}) {
  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/integracoes" footerLabel="Credenciais protegidas" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/integracoes" statusLabel="Cofre ativo" />
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div>
              <Link className="integration-back-link" href="/dashboard/integracoes">← Todas as integrações</Link>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
            </div>
          </header>
          <IntegrationNotices status={status} />
          {!vaultReady ? <div className="notice notice-error">O cofre central ainda não possui chave de criptografia no servidor. Os campos permanecem bloqueados.</div> : null}
          {children}
        </div>
      </section>
    </main>
  );
}

export function IntegrationForm({ provider, title, projectId, current, disabled }: {
  provider: IntegrationProvider; title: string; projectId: string;
  current?: Configured; disabled: boolean;
}) {
  const config = current?.configuration ?? {};
  const canValidate = ["cloudflare_r2", "clamav", "meta_ads", "railway", "cloudflare_account"].includes(provider);
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
        <small>Redirect URI: https://app.funilmetrics.site/dashboard/integracoes/google-drive/callback</small>
      </> : provider === "meta_ads_app" ? <>
        <label>App ID<input defaultValue={String(config.appId ?? "")} disabled={disabled} name="app_id" inputMode="numeric" /></label>
        <label>App Secret<input disabled={disabled} name="app_secret" placeholder={current?.has_secret ? "•••••••••••• (substituir)" : "Segredo do app Meta"} type="password" /></label>
        <small>Redirect URI: https://app.funilmetrics.site/dashboard/integracoes/meta/callback</small>
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
