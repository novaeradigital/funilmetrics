import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function CloudflarePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="Domínios próprios" status={query.status} title="Cloudflare" vaultReady={vaultReady}>
      <p className="dashboard-context">Token de DNS usado pelos domínios próprios conectados ao projeto.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="cloudflare_account" title="Cloudflare · domínios próprios" projectId={scope.project_id} current={byProvider.get("cloudflare_account")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
