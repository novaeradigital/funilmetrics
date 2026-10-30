import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function ClamavPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="Segurança" status={query.status} title="ClamAV" vaultReady={vaultReady}>
      <p className="dashboard-context">Varredura antimalware dos arquivos importados, feita em rede privada antes de entrarem na Central de Criativos.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="clamav" title="ClamAV" projectId={scope.project_id} current={byProvider.get("clamav")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
