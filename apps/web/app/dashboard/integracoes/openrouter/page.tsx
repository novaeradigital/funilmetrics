import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function OpenRouterPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="IA de criativos" status={query.status} title="OpenRouter" vaultReady={vaultReady}>
      <p className="dashboard-context">Chave da API e modelos do OpenRouter: um saldo só para modelos da OpenAI, Anthropic, Google e outros. Ele assume análise, copy e transcrição quando é a ferramenta escolhida no cartão da OpenAI (configuração de IA do projeto, decisão D-172).</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="openrouter" title="OpenRouter" projectId={scope.project_id} current={byProvider.get("openrouter")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
