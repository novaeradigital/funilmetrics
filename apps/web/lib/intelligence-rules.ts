/**
 * Inteligencia (fase 1) - motor de regras determinístico dos vereditos.
 *
 * Nenhum veredito nasce de IA: cada um sai de uma regra numerica sobre os
 * agregados do periodo, com os limiares configuraveis por projeto. A regra
 * que disparou volta escrita, com os numeros, pra tela mostrar o porque.
 * Metrica ausente (null) nunca dispara regra: sem dado, sem veredito.
 */

export type IntelligenceThresholds = {
  /** Meta de ROAS do projeto (receita / investimento). */
  roasGoal: number;
  /** CPA alvo do projeto, na moeda da operacao. */
  cpaTarget: number;
  /** Vendas minimas no periodo pra considerar um criativo provado. */
  minSales: number;
  /** Frequencia media a partir da qual o criativo mostra fadiga. */
  fatigueFreq: number;
  /** Queda de CTR entre metades do periodo, em %, que marca fadiga. */
  ctrDropPct: number;
  /** Hook rate (views 3s / impressoes) abaixo do qual o gancho e fraco. */
  hookWeakPct: number;
  /** Hook rate a partir do qual o gancho e forte. */
  hookStrongPct: number;
  /** ThruPlay rate (thruplay / views 3s) abaixo do qual a retencao e fraca. */
  thruWeakPct: number;
  /** Views de 3s minimas pra julgar o gancho. */
  minViews: number;
  /** Cliques minimos pra julgar a conversao pos-clique. */
  minClicks: number;
  /** Multiplo do CPA alvo gasto sem venda que manda aposentar. */
  retireMultiple: number;
};

export const DEFAULT_THRESHOLDS: IntelligenceThresholds = {
  roasGoal: 2,
  cpaTarget: 100,
  minSales: 3,
  fatigueFreq: 2.5,
  ctrDropPct: 20,
  hookWeakPct: 25,
  hookStrongPct: 30,
  thruWeakPct: 30,
  minViews: 100,
  minClicks: 20,
  retireMultiple: 2,
};

export type CreativeMetrics = {
  creativeId: string;
  spend: number;
  sales: number;
  revenue: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  views3s: number | null;
  thruplay: number | null;
  roas: number | null;
  ctr: number | null;
  ctrFirstHalf: number | null;
  ctrSecondHalf: number | null;
  frequency: number | null;
  hookRate: number | null;
  thruRate: number | null;
  /** Contas ativas do mesmo projeto de negocio onde o criativo NAO rodou. */
  missingAccounts: { id: string; name: string }[];
};

export type VerdictKind =
  | "escalar"
  | "duplicar"
  | "outra_conta"
  | "novo_gancho"
  | "mesmo_gancho"
  | "aposentar";

export type Verdict = {
  kind: VerdictKind;
  /** A regra que disparou, escrita com os numeros usados. */
  rule: string;
};

function num(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pct(value: number): string {
  return `${num(value, 1)}%`;
}

export function ctrDropping(metrics: CreativeMetrics, thresholds: IntelligenceThresholds): boolean {
  if (metrics.ctrFirstHalf === null || metrics.ctrSecondHalf === null) return false;
  if (metrics.ctrFirstHalf <= 0) return false;
  const drop = ((metrics.ctrFirstHalf - metrics.ctrSecondHalf) / metrics.ctrFirstHalf) * 100;
  return drop >= thresholds.ctrDropPct;
}

/** Avalia um criativo e devolve todos os vereditos que as regras disparam. */
export function evaluateCreative(
  metrics: CreativeMetrics,
  thresholds: IntelligenceThresholds,
): Verdict[] {
  const t = thresholds;
  const verdicts: Verdict[] = [];
  const dropping = ctrDropping(metrics, t);
  const fatigued =
    (metrics.frequency !== null && metrics.frequency >= t.fatigueFreq) || dropping;

  if (
    metrics.roas !== null &&
    metrics.roas >= t.roasGoal &&
    metrics.sales >= t.minSales &&
    !fatigued
  ) {
    verdicts.push({
      kind: "escalar",
      rule: `ROAS ${num(metrics.roas)} acima da meta ${num(t.roasGoal)}, ${metrics.sales} vendas no periodo e sem fadiga (frequencia ${metrics.frequency === null ? "sem dado" : num(metrics.frequency)}).`,
    });
  }

  if (
    metrics.sales >= t.minSales &&
    metrics.roas !== null &&
    metrics.roas >= t.roasGoal * 0.8 &&
    metrics.frequency !== null &&
    metrics.frequency >= t.fatigueFreq &&
    dropping
  ) {
    verdicts.push({
      kind: "duplicar",
      rule: `Vende bem (${metrics.sales} vendas, ROAS ${num(metrics.roas)}) mas com frequencia alta (${num(metrics.frequency)}) e CTR em queda de ${pct(((metrics.ctrFirstHalf! - metrics.ctrSecondHalf!) / metrics.ctrFirstHalf!) * 100)} entre as metades do periodo.`,
    });
  }

  if (metrics.sales >= t.minSales && metrics.missingAccounts.length > 0) {
    verdicts.push({
      kind: "outra_conta",
      rule: `Provado com ${metrics.sales} vendas e ainda nao rodou em: ${metrics.missingAccounts.map((a) => a.name).join(", ")}.`,
    });
  }

  if (
    metrics.sales >= 1 &&
    metrics.views3s !== null &&
    metrics.views3s >= t.minViews &&
    ((metrics.hookRate !== null && metrics.hookRate < t.hookWeakPct) ||
      (metrics.thruRate !== null && metrics.thruRate < t.thruWeakPct))
  ) {
    const parts: string[] = [];
    if (metrics.hookRate !== null && metrics.hookRate < t.hookWeakPct)
      parts.push(`hook rate ${pct(metrics.hookRate)} (abaixo de ${pct(t.hookWeakPct)})`);
    if (metrics.thruRate !== null && metrics.thruRate < t.thruWeakPct)
      parts.push(`thruplay ${pct(metrics.thruRate)} (abaixo de ${pct(t.thruWeakPct)})`);
    verdicts.push({
      kind: "novo_gancho",
      rule: `O corpo converte (${metrics.sales} venda(s) no periodo), mas o gancho segura pouco: ${parts.join(" e ")}.`,
    });
  }

  if (
    metrics.sales === 0 &&
    metrics.views3s !== null &&
    metrics.views3s >= t.minViews &&
    metrics.hookRate !== null &&
    metrics.hookRate >= t.hookStrongPct &&
    metrics.linkClicks >= t.minClicks
  ) {
    verdicts.push({
      kind: "mesmo_gancho",
      rule: `Gancho forte (hook rate ${pct(metrics.hookRate)}), mas nenhum dos ${metrics.linkClicks} cliques virou venda: o problema esta no corpo ou na pagina.`,
    });
  }

  if (metrics.sales === 0 && metrics.spend >= t.retireMultiple * t.cpaTarget) {
    verdicts.push({
      kind: "aposentar",
      rule: `Gastou R$ ${num(metrics.spend)} (${num(metrics.spend / t.cpaTarget, 1)}x o CPA alvo de R$ ${num(t.cpaTarget)}) sem nenhuma venda no periodo.`,
    });
  }

  return verdicts;
}

/** Contagem dos cartoes de vereditos do topo (Renovar agrega 3 acoes). */
export function verdictCounts(verdictsByCreative: Verdict[][]): {
  escalar: number;
  duplicar: number;
  outraConta: number;
  renovar: number;
} {
  let escalar = 0,
    duplicar = 0,
    outraConta = 0,
    renovar = 0;
  for (const list of verdictsByCreative) {
    const kinds = new Set(list.map((v) => v.kind));
    if (kinds.has("escalar")) escalar += 1;
    if (kinds.has("duplicar")) duplicar += 1;
    if (kinds.has("outra_conta")) outraConta += 1;
    if (kinds.has("novo_gancho") || kinds.has("mesmo_gancho") || kinds.has("aposentar"))
      renovar += 1;
  }
  return { escalar, duplicar, outraConta, renovar };
}
