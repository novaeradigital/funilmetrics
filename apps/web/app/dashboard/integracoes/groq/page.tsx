import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function GroqPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="IA de criativos" status={query.status} title="Groq" vaultReady={vaultReady}>
      <p className="dashboard-context">Chave da API e modelo de transcrição de áudio dos vídeos (Whisper na Groq). A Groq assume a transcrição quando é a ferramenta escolhida no cartão da OpenAI (configuração de IA do projeto, decisão D-172).</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="groq" title="Groq" projectId={scope.project_id} current={byProvider.get("groq")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
