import { getDatabase } from "../../../../lib/database";
import { saveAiPricing, updateOpenAiBudget } from "../actions";
import {
  IntegrationForm,
  PlatformShell,
  loadIntegrationContext,
} from "../shared";

export const dynamic = "force-dynamic";

type AiUsageSummary = { jobs: string; input_tokens: string; output_tokens: string; estimated_cost_brl: string | null };
type AiPricing = { id: string; model: string; operation: string; input_cost_per_million_brl: string | null; output_cost_per_million_brl: string | null; audio_cost_per_minute_brl: string | null; source_reference: string | null; valid_from: Date };

export default async function OpenAiPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const query = await searchParams;
  const { scope, byProvider, canEdit, vaultReady } = await loadIntegrationContext();
  const database = getDatabase();
  const aiUsage = (
    await database.pool.query<AiUsageSummary>(
      `select count(*)::text jobs,coalesce(sum(input_tokens),0)::text input_tokens,
       coalesce(sum(output_tokens),0)::text output_tokens,
       sum(estimated_cost_brl)::text estimated_cost_brl
       from public.ai_usage_records where project_id=$1
       and measured_at>=date_trunc('month',now())`,
      [scope.project_id],
    )
  ).rows[0];
  const aiPricing = (await database.pool.query<AiPricing>(
    `select id,model,operation,input_cost_per_million_brl,
      output_cost_per_million_brl,audio_cost_per_minute_brl,
      source_reference,valid_from
      from public.ai_project_pricing_versions
      where project_id=$1 and valid_until is null order by operation,model`,
    [scope.project_id])).rows;
  const openai = byProvider.get("openai");

  return (
    <PlatformShell eyebrow="IA de criativos" status={query.status} title="OpenAI" vaultReady={vaultReady}>
      <p className="dashboard-context">Chave da API, modelos usados na análise e na transcrição, preços e limite mensal.</p>
      <section className="integration-config-grid">
        <IntegrationForm provider="openai" title="OpenAI" projectId={scope.project_id} current={openai} disabled={!vaultReady || !canEdit} />
      </section>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><p className="panel-label">OpenAI · preços em BRL</p><h2>Precificação versionada</h2></div><span>{aiPricing.length} preço(s) ativo(s)</span></div>
        <div className="integration-config-grid">
          {(["creative_analysis", "creative_transcription"] as const).map((operation) => {
            const model = String(operation === "creative_analysis"
              ? openai?.configuration.analysisModel ?? ""
              : openai?.configuration.transcriptionModel ?? "");
            const current = aiPricing.find((item) => item.operation === operation && item.model === model);
            return <form action={saveAiPricing} className="integration-config-card" key={operation}>
              <input name="project_id" type="hidden" value={scope.project_id} />
              <input name="operation" type="hidden" value={operation} />
              <label>Operação<input readOnly value={operation === "creative_analysis" ? "Análise de criativo" : "Transcrição"} /></label>
              <label>Modelo<input name="model" readOnly value={model} /></label>
              {operation === "creative_analysis" ? <>
                <label>Entrada por 1 milhão de tokens (R$)<input defaultValue={current?.input_cost_per_million_brl ?? ""} min="0" name="input_cost_per_million_brl" step="0.00000001" type="number" /></label>
                <label>Saída por 1 milhão de tokens (R$)<input defaultValue={current?.output_cost_per_million_brl ?? ""} min="0" name="output_cost_per_million_brl" step="0.00000001" type="number" /></label>
              </> : <label>Áudio por minuto (R$)<input defaultValue={current?.audio_cost_per_minute_brl ?? ""} min="0" name="audio_cost_per_minute_brl" step="0.00000001" type="number" /></label>}
              <label>Fonte do preço<input defaultValue={current?.source_reference ?? ""} name="source_reference" placeholder="URL ou referência da tabela utilizada" /></label>
              <small>{current ? `Versão ativa desde ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(current.valid_from)}` : "Preço ainda não informado. O uso permanece medido, com custo desconhecido."}</small>
              <button disabled={!canEdit || !model} type="submit">Criar nova versão</button>
            </form>;
          })}
        </div>
      </section>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><p className="panel-label">OpenAI · mês atual</p><h2>Uso medido</h2></div></div>
        <div className="creative-foundation-grid">
          <article><span>Execuções medidas</span><strong>{aiUsage?.jobs ?? "0"}</strong></article>
          <article><span>Tokens de entrada</span><strong>{aiUsage?.input_tokens ?? "0"}</strong></article>
          <article><span>Tokens de saída</span><strong>{aiUsage?.output_tokens ?? "0"}</strong></article>
          <article><span>Custo estimado</span><strong>{aiUsage?.estimated_cost_brl ? `R$ ${aiUsage.estimated_cost_brl}` : "Preço não configurado"}</strong></article>
        </div>
        {!aiUsage?.estimated_cost_brl ? <small>O sistema não apresenta custo zero: falta uma tabela de preços válida para converter o uso medido.</small> : null}
        {openai ? (
          <form action={updateOpenAiBudget} className="inline-filter-form">
            <input name="project_id" type="hidden" value={scope.project_id} />
            <label>Limite mensal operacional (R$)
              <input
                defaultValue={String(openai.configuration.monthlyBudgetBrl ?? "100")}
                disabled={!canEdit}
                min="1"
                name="monthly_budget_brl"
                step="1"
                type="number"
              />
            </label>
            <button disabled={!canEdit} type="submit">Atualizar limite</button>
          </form>
        ) : null}
      </section>
    </PlatformShell>
  );
}
