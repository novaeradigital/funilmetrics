/**
 * Inteligencia (fase 1, D-186) - contexto do chat montado no servidor.
 *
 * O chat so recebe numeros que estao nestas tabelas compactas; o prompt do
 * sistema proibe usar qualquer numero fora daqui. Vereditos sao os do motor
 * de regras, o chat explica e escreve, nao decide numero.
 */
import type pg from "pg";
import type { IntelligenceData } from "./intelligence-data";

function n(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "sem dados";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(value: number): string {
  return `R$ ${n(value)}`;
}

const VERDICT_LABEL: Record<string, string> = {
  escalar: "Escalar",
  duplicar: "Duplicar",
  outra_conta: "Outra conta",
  novo_gancho: "Novo gancho",
  mesmo_gancho: "Mesmo gancho outro corpo",
  aposentar: "Aposentar",
};

export function buildIntelligenceContext(
  data: IntelligenceData,
  scopeLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`Escopo da tela: ${scopeLabel}. Receita no estagio bruto (vendas atribuidas pelo ID do anuncio no utm_content).`);
  const t = data.thresholds;
  lines.push(
    `Limiares das regras: meta de ROAS ${n(t.roasGoal)}, CPA alvo ${money(t.cpaTarget)}, vendas minimas ${t.minSales}, frequencia de fadiga ${n(t.fatigueFreq)}, queda de CTR ${n(t.ctrDropPct, 0)}%.`,
  );

  lines.push("\nVEREDITOS (do motor de regras, com a regra que disparou):");
  let anyVerdict = false;
  for (const creative of data.creatives) {
    for (const verdict of creative.verdicts) {
      anyVerdict = true;
      lines.push(`- ${creative.name}: ${VERDICT_LABEL[verdict.kind] ?? verdict.kind}. Regra: ${verdict.rule}`);
    }
  }
  if (!anyVerdict) lines.push("- Nenhum veredito disparou no periodo com os limiares atuais.");

  lines.push("\nCRIATIVOS (por investimento): nome | formato | investimento | vendas | receita | ROAS | CPA | CTR | frequencia | hook rate | thruplay | p50 | dias ativo");
  for (const c of data.creatives.slice(0, 20)) {
    lines.push(
      `- ${c.name} | ${c.format ?? "sem classificação"} | ${money(c.spend)} | ${c.sales} | ${money(c.revenue)} | ${n(c.roas)} | ${c.cpa === null ? "sem dados" : money(c.cpa)} | ${c.ctr === null ? "sem dados" : `${n(c.ctr, 1)}%`} | ${n(c.frequency, 1)} | ${c.hookRate === null ? "sem dados" : `${n(c.hookRate, 1)}%`} | ${c.thruRate === null ? "sem dados" : `${n(c.thruRate, 1)}%`} | ${c.p50Rate === null ? "sem dados" : `${n(c.p50Rate, 1)}%`} | ${c.daysActive}`,
    );
  }
  if (data.creatives.length === 0) lines.push("- Sem criativos com dados no periodo.");

  lines.push("\nCAMPANHAS (por investimento): nome | investimento | vendas | receita | ROAS | CPA | CTR | frequencia | dias ativo | vereditos");
  for (const c of data.campaigns.slice(0, 12)) {
    lines.push(
      `- ${c.name} | ${money(c.spend)} | ${c.sales} | ${money(c.revenue)} | ${n(c.roas)} | ${c.cpa === null ? "sem dados" : money(c.cpa)} | ${c.ctr === null ? "sem dados" : `${n(c.ctr, 1)}%`} | ${n(c.frequency, 1)} | ${c.daysActive} | ${c.verdicts.map((v) => VERDICT_LABEL[v] ?? v).join(", ") || "nenhum"}`,
    );
  }

  lines.push("\nFORMATOS: formato | criativos | investimento | vendas | receita | ROAS | participacao do investimento");
  for (const f of data.formats) {
    lines.push(
      `- ${f.format} | ${f.creatives} | ${money(f.spend)} | ${f.sales} | ${money(f.revenue)} | ${n(f.roas)} | ${f.share === null ? "sem dados" : `${n(f.share, 1)}%`}`,
    );
  }

  lines.push("\nGANCHOS (agrupados, mesmo gancho em corpos diferentes): gancho | corpos | investimento | vendas | CTR | hook rate | thruplay");
  for (const h of data.hooks.slice(0, 12)) {
    lines.push(
      `- "${h.hook}" | ${h.bodies} | ${money(h.spend)} | ${h.sales} | ${h.ctr === null ? "sem dados" : `${n(h.ctr, 1)}%`} | ${h.hookRate === null ? "sem dados" : `${n(h.hookRate, 1)}%`} | ${h.thruRate === null ? "sem dados" : `${n(h.thruRate, 1)}%`}`,
    );
  }

  if (data.organic.sales > 0) {
    lines.push(`\nFora dos rankings: ${data.organic.sales} venda(s) sem anuncio identificado (organico ou sem ID no utm_content), ${money(data.organic.revenue)}.`);
  }
  return lines.join("\n");
}

export type CitedCreativeContext = {
  name: string;
  format: string | null;
  hook: string | null;
  promise: string | null;
  mechanism: string | null;
  transcript: string | null;
};

/** Criativos citados na pergunta (nome ou pedaco dele) ganham contexto cheio. */
export async function loadCitedCreatives(
  pool: pg.Pool,
  projectId: string,
  message: string,
): Promise<CitedCreativeContext[]> {
  const rows = (
    await pool.query<{ id: string; name: string; format: string | null; hook: string | null; promise: string | null; mechanism: string | null; transcript: string | null }>(
      `select c.id::text as id, c.name, a.format, a.hook, a.promise, a.mechanism,
         t.text as transcript
         from public.creatives c
         left join lateral (
           select format, hook, promise, mechanism from public.creative_analyses
            where creative_id = c.id order by created_at desc limit 1
         ) a on true
         left join lateral (
           select text from public.creative_transcripts
            where creative_version_id = c.current_version_id
            order by created_at desc limit 1
         ) t on true
        where c.project_id = $1`,
      [projectId],
    )
  ).rows;
  const normalized = message.toLowerCase();
  const cited = rows.filter((row) => {
    const name = row.name.toLowerCase();
    if (name.length >= 4 && normalized.includes(name)) return true;
    const tokens = name.split(/[^a-z0-9]+/i).filter((token) => token.length >= 4);
    return tokens.some((token) => normalized.includes(token.toLowerCase()));
  });
  return cited.slice(0, 3).map((row) => ({
    name: row.name,
    format: row.format,
    hook: row.hook,
    promise: row.promise,
    mechanism: row.mechanism,
    transcript: row.transcript ? row.transcript.slice(0, 4000) : null,
  }));
}

export function citedContextText(cited: CitedCreativeContext[]): string {
  if (cited.length === 0) return "";
  const lines = ["\nCRIATIVOS CITADOS (analise e transcricao):"];
  for (const c of cited) {
    lines.push(`\n## ${c.name}`);
    lines.push(`Formato: ${c.format ?? "sem classificação"}`);
    lines.push(`Gancho da analise: ${c.hook ?? "sem dados"}`);
    lines.push(`Promessa: ${c.promise ?? "sem dados"}`);
    lines.push(`Mecanismo: ${c.mechanism ?? "sem dados"}`);
    lines.push(`Transcricao: ${c.transcript ?? "sem transcricao disponivel"}`);
  }
  return lines.join("\n");
}

export const INTELLIGENCE_CHAT_SYSTEM = `Voce e o assistente da pagina Inteligencia do Funil Metrics. Responda em portugues do Brasil, direto e curto.

REGRAS DE HONESTIDADE (inviolaveis):
1. Numero so vale se estiver no CONTEXTO abaixo. Metrica que nao estiver no contexto, voce diz que nao tem esse dado, sem estimar e sem inventar.
2. Veredito (escalar, duplicar, aposentar etc.) e do motor de regras deterministico, nao seu. Voce explica o veredito e a regra que disparou; nunca cria veredito novo nem muda numero.
3. Voce pode escrever ganchos, corpos e comparacoes usando as transcricoes e analises do contexto. Quando escrever criativo novo, deixe claro que e sugestao sua.
4. Nesta fase voce e consultivo: nao executa acao nenhuma na Meta nem no sistema.`;
