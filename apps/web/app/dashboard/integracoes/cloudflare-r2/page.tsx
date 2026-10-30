import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function CloudflareR2Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="Armazenamento" status={query.status} title="Cloudflare R2" vaultReady={vaultReady}>
      <p className="dashboard-context">Bucket privado onde ficam os arquivos de mídia importados pela Central de Criativos.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="cloudflare_r2" title="Cloudflare R2" projectId={scope.project_id} current={byProvider.get("cloudflare_r2")} disabled={!vaultReady || !canEdit} />
      </section>
    </PlatformShell>
  );
}
