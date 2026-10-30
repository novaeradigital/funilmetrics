import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function RailwayPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="Domínios e infraestrutura" status={query.status} title="Railway" vaultReady={vaultReady}>
      <p className="dashboard-context">Acesso usado para provisionar os hostnames dos domínios de rastreamento na Railway.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="railway" title="Railway · domínios" projectId={scope.project_id} current={byProvider.get("railway")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
