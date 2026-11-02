import { getDatabase } from "../../../lib/database";
import { DashboardSidebar } from "../dashboard-sidebar";
import { DashboardTopbar } from "../dashboard-topbar";
import { IntegrationsHub, type HubCard, type HubGroup } from "./hub-client";
import {
  IntegrationNotices,
  loadIntegrationContext,
  type Configured,
} from "./shared";

export const dynamic = "force-dynamic";

function providerStatus(current: Configured | undefined): { status: string; active: boolean } {
  if (!current) return { status: "Não configurado", active: false };
  const validation = String(current.configuration.validationStatus ?? "");
  if (validation === "valid") return { status: "Validada", active: true };
  if (validation === "invalid") return { status: "Inválida", active: false };
  if (current.has_secret) return { status: "Credencial salva", active: true };
  return { status: "Configurado", active: true };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, vaultReady, organizationId, timezone } = await loadIntegrationContext();
  const database = getDatabase();
  const lastlinkSummary = (await database.pool.query<{ total: number; active: number; last_event_at: Date | null }>(
    `select count(distinct connection.id)::int total,
            count(distinct connection.id) filter(where connection.status='active')::int active,
            max(event.received_at) last_event_at
       from public.connections connection
       left join public.raw_events event on event.connection_id=connection.id
      where connection.organization_id=$1 and connection.project_id=$2
        and connection.provider='lastlink'`,
    [organizationId, scope.project_id],
  )).rows[0] ?? { total: 0, active: 0, last_event_at: null };
  const configCheckoutSummary = (await database.pool.query<{ total: number; active: number; last_event_at: Date | null }>(
    `select count(distinct connection.id)::int total,
            count(distinct connection.id) filter(where connection.status='active')::int active,
            max(event.received_at) last_event_at
       from public.connections connection
       left join public.raw_events event on event.connection_id=connection.id
      where connection.organization_id=$1 and connection.project_id=$2
        and connection.provider='configcheckout'`,
    [organizationId, scope.project_id],
  )).rows[0] ?? { total: 0, active: 0, last_event_at: null };

  const formatWhen = (when: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: timezone,
    }).format(when);

  const metaConnections = [...byProvider.values()].filter((item) => item.provider === "meta_ads");
  const metaApp = byProvider.get("meta_ads_app");
  const metaExpired = ((await database.pool.query<{ total: number }>(
    `select count(*)::int as total from public.meta_authorizations
      where project_id=$1 and status='expired'`,
    [scope.project_id],
  )).rows[0]?.total ?? 0) > 0;
  const metaStatus = metaExpired
    ? { status: "Autorização expirada, reconectar", active: false }
    : metaConnections.length
    ? { status: `${metaConnections.length} conexão(ões) ativa(s)`, active: true }
    : metaApp?.has_secret
      ? { status: "App configurado · sem conexão", active: true }
      : { status: "Não configurado", active: false };

  const vendas: HubCard[] = [
    {
      id: "lastlink",
      name: "Lastlink",
      href: "/dashboard/integracoes/lastlink",
      status: lastlinkSummary.total ? `${lastlinkSummary.active} de ${lastlinkSummary.total} produto(s) conectado(s)` : "Nenhum produto conectado",
      active: lastlinkSummary.active > 0,
      detail: lastlinkSummary.last_event_at ? `Último evento em ${formatWhen(lastlinkSummary.last_event_at)}` : "Cada produto recebe uma URL e um token próprios.",
      cta: lastlinkSummary.total ? "Gerenciar produtos" : "Conectar produto",
    },
    {
      id: "configcheckout",
      name: "ConfigCheckout",
      href: "/dashboard/integracoes/configcheckout",
      status: configCheckoutSummary.total ? `${configCheckoutSummary.active} de ${configCheckoutSummary.total} vendedor(es) conectado(s)` : "Nenhum vendedor conectado",
      active: configCheckoutSummary.active > 0,
      detail: configCheckoutSummary.last_event_at ? `Último evento em ${formatWhen(configCheckoutSummary.last_event_at)}` : "Cada vendedor recebe uma URL e um token próprios.",
      cta: configCheckoutSummary.total ? "Gerenciar vendedores" : "Conectar vendedor",
    },
  ];
  const marketing: HubCard[] = [
    {
      id: "meta",
      name: "Meta Ads",
      href: "/dashboard/integracoes/meta",
      status: metaStatus.status,
      active: metaStatus.active,
      detail: metaExpired ? "A autorização venceu e a sincronização parou. Reconecte para retomar." : "OAuth do cliente, usuário do sistema, sincronização e catálogo autorizado.",
      cta: metaExpired ? "Reconectar" : "Gerenciar",
    },
  ];
  const criativos: HubCard[] = [
    {
      id: "google_drive",
      name: "Google Drive",
      href: "/dashboard/integracoes/google-drive",
      ...providerStatus(byProvider.get("google_drive_app")),
      detail: "Credenciais do app Google e a política de mídia das importações.",
      cta: "Gerenciar",
    },
    {
      id: "openai",
      name: "OpenAI",
      href: "/dashboard/integracoes/openai",
      ...providerStatus(byProvider.get("openai")),
      detail: "Chave da API, modelos, precificação versionada e uso medido do mês. É aqui que fica a configuração de IA do projeto: qual ferramenta transcreve e qual analisa.",
      cta: "Gerenciar",
    },
    {
      id: "anthropic",
      name: "Anthropic (Claude)",
      href: "/dashboard/integracoes/anthropic",
      ...providerStatus(byProvider.get("anthropic")),
      detail: "Chave da API e modelo do Claude para análise e copy, quando ele é a ferramenta escolhida.",
      cta: "Gerenciar",
    },
    {
      id: "groq",
      name: "Groq",
      href: "/dashboard/integracoes/groq",
      ...providerStatus(byProvider.get("groq")),
      detail: "Chave da API e modelo de transcrição de áudio dos vídeos (Whisper).",
      cta: "Gerenciar",
    },
  ];
  const infraestrutura: HubCard[] = [
    {
      id: "cloudflare_r2",
      name: "Cloudflare R2",
      href: "/dashboard/integracoes/cloudflare-r2",
      ...providerStatus(byProvider.get("cloudflare_r2")),
      detail: "Bucket privado onde ficam os arquivos de mídia importados.",
      cta: "Gerenciar",
    },
    {
      id: "clamav",
      name: "ClamAV",
      href: "/dashboard/integracoes/clamav",
      ...providerStatus(byProvider.get("clamav")),
      detail: "Varredura antimalware dos arquivos antes de entrarem na central.",
      cta: "Gerenciar",
    },
    {
      id: "railway",
      name: "Railway",
      href: "/dashboard/integracoes/railway",
      ...providerStatus(byProvider.get("railway")),
      detail: "Provisionamento de hostnames dos domínios de rastreamento.",
      cta: "Gerenciar",
    },
    {
      id: "cloudflare",
      name: "Cloudflare",
      href: "/dashboard/integracoes/cloudflare",
      ...providerStatus(byProvider.get("cloudflare_account")),
      detail: "Token de DNS para os domínios próprios conectados ao projeto.",
      cta: "Gerenciar",
    },
  ];
  const groups: HubGroup[] = [
    { id: "vendas", title: "Vendas", description: "Dados de vendas, transações e faturamento vindos das plataformas de checkout.", cards: vendas },
    { id: "marketing", title: "Marketing", description: "Dados de tráfego, conversões e campanhas de marketing.", cards: marketing },
    { id: "criativos", title: "Criativos e IA", description: "Fontes de arquivos e inteligência artificial da Central de Criativos.", cards: criativos },
    { id: "infraestrutura", title: "Infraestrutura", description: "Armazenamento, segurança e domínios que sustentam a operação.", cards: infraestrutura },
  ];

  return (
    <main className="app-layout">
      <DashboardSidebar activeHref="/dashboard/integracoes" footerLabel="Credenciais protegidas" />
      <section className="app-content">
        <DashboardTopbar returnTo="/dashboard/integracoes" statusLabel="Cofre ativo" />
        <div className="dashboard-main">
          <header className="dashboard-titlebar">
            <div>
              <p className="eyebrow">Credenciais e serviços</p>
              <h1>Integrações</h1>
              <p className="dashboard-context">Conecte suas fontes de dados e comece a extrair insights. Clique em uma plataforma para ver as informações e os campos da integração.</p>
            </div>
          </header>
          <IntegrationNotices status={query.status} />
          {!vaultReady ? <div className="notice notice-error">O cofre central ainda não possui chave de criptografia no servidor. Os campos permanecem bloqueados.</div> : null}
          <IntegrationsHub groups={groups} />
        </div>
      </section>
    </main>
  );
}
