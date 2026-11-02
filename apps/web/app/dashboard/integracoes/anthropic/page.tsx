import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function AnthropicPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="IA de criativos" status={query.status} title="Anthropic (Claude)" vaultReady={vaultReady}>
      <p className="dashboard-context">Chave da API e modelo do Claude. Ele assume a análise de criativos e a geração de copy quando é a ferramenta escolhida no cartão da OpenAI (configuração de IA do projeto, decisão D-172).</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="anthropic" title="Anthropic (Claude)" projectId={scope.project_id} current={byProvider.get("anthropic")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
