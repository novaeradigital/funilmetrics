import { CREATIVE_MEDIA_POLICY_V1 } from "@funil-metrics/domain";
import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

export default async function GoogleDrivePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  return (
    <PlatformShell eyebrow="Central de Criativos" status={query.status} title="Google Drive" vaultReady={vaultReady}>
      <p className="dashboard-context">Credenciais do aplicativo Google usado para importar os criativos das pastas conectadas.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="google_drive_app" title="Google Drive" projectId={scope.project_id} current={byProvider.get("google_drive_app")} disabled={!vaultReady || !canEdit} />
      </section>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><p className="panel-label">Central de Criativos</p>
          <h2>Política efetiva de mídia</h2></div><span>{CREATIVE_MEDIA_POLICY_V1.version}</span></div>
        <p className="dashboard-context">Limites aplicados pelo worker. Esta visão é somente leitura e não altera importações.</p>
        <p className="dashboard-context">
          Por execução: até {CREATIVE_MEDIA_POLICY_V1.execution.maxFiles.toLocaleString("pt-BR")} arquivos e{" "}
          {CREATIVE_MEDIA_POLICY_V1.execution.maxBytes / 1024 ** 3} GB.
        </p>
        <div className="table-shell"><table><thead><tr><th>MIME type</th><th>Limite</th><th>Tratamento</th></tr></thead>
          <tbody>{Object.entries(CREATIVE_MEDIA_POLICY_V1.formats).map(([mime, rule]) => <tr key={mime}>
            <td>{mime}</td><td>{rule.maxBytes >= 1024 ** 3 ? `${rule.maxBytes / 1024 ** 3} GB` : `${rule.maxBytes / 1024 ** 2} MB`}</td>
            <td>{"export" in rule ? "Exportação oficial para DOCX" : "Cópia binária por streaming"}</td>
          </tr>)}</tbody></table></div>
        <small>Arquivos fora da lista são rejeitados. A importação continua sujeita à varredura antimalware e ao limite do scanner configurado no projeto.</small>
      </section>
    </PlatformShell>
  );
}
