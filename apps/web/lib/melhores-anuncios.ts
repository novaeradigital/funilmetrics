/**
 * Melhores anúncios: regras puras da tela (D-160).
 *
 * O ranking cruza gasto e comportamento da Meta com as vendas reais
 * atribuídas ao anúncio (ID no utm_content da venda, mesma régua do
 * Dashboard Inteligente). As definições seguem docs/METRICAS.md:
 * métrica derivada com denominador zero ou dado ausente é indisponível
 * (null), nunca zero fabricado.
 */

import { shiftCalendarDate } from "./calendar-date";

/** Referência visual de retenção saudável, em % (régua da tela, não é meta). */
export const RETENTION_BENCHMARK = 30;
/** Abaixo disso a retenção entra em atenção; abaixo de 20, crítica. */
export const RETENTION_WARN_FLOOR = 20;

export type RetentionLevel = "good" | "warn" | "bad";

/** Hook rate: visualizações de 3 segundos sobre as impressões, em %. */
export function hookRate(views3s: number | null, impressions: number): number | null {
  if (views3s === null || impressions <= 0) return null;
  return (views3s / impressions) * 100;
}

/** Body rate: thruplay sobre as visualizações de 3 segundos, em %. */
export function bodyRate(thruplay: number | null, views3s: number | null): number | null {
  if (thruplay === null || views3s === null || views3s <= 0) return null;
  return (thruplay / views3s) * 100;
}

/** Faixa visual de uma taxa de retenção contra a régua de referência. */
export function retentionLevel(rate: number | null): RetentionLevel | null {
  if (rate === null) return null;
  if (rate >= RETENTION_BENCHMARK) return "good";
  if (rate >= RETENTION_WARN_FLOOR) return "warn";
  return "bad";
}

/** Taxa de passagem entre duas etapas vizinhas do funil, em %. */
export function stageRate(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current / previous) * 100;
}

/**
 * Diagnóstico curto do criativo pelo cruzamento hook × body.
 * Retorna null quando falta uma das duas taxas.
 */
export function retentionDiagnosis(hook: number | null, body: number | null): string | null {
  if (hook === null || body === null) return null;
  const hookGood = hook >= RETENTION_BENCHMARK;
  const bodyGood = body >= RETENTION_BENCHMARK;
  if (hookGood && bodyGood)
    return "Hook e corpo seguram a atenção. Se o retorno não vem, o vazamento está depois do vídeo, na página ou na oferta.";
  if (hookGood)
    return "O hook promete e o corpo não entrega. Revisar a sequência logo depois dos primeiros segundos.";
  if (bodyGood)
    return "O corpo segura quem fica. Trocar só os 3 primeiros segundos e reaproveitar o restante do criativo.";
  return "Hook e corpo fracos. Candidato a aposentar ou regravar o criativo.";
}

export type PeriodPreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "month" | "all" | "custom";

export type ResolvedRange = {
  from: string | null;
  to: string | null;
  preset: PeriodPreset;
  label: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string | null | undefined): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

/** "2026-10-01" vira "1 de out. de 2026" (fuso UTC, data de calendário). */
export function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatRangeLabel(from: string, to: string): string {
  if (from === to) return formatCalendarDate(from);
  return `${formatCalendarDate(from)} a ${formatCalendarDate(to)}`;
}

/**
 * Resolve o período da tela (D-161): intervalo explícito from/to válido
 * vence; senão o preset pedido; o padrão é Últimos 30 dias. `today` é a
 * data de calendário de hoje no fuso do projeto.
 */
export function resolveDateRange(
  input: { from?: string; to?: string; period?: string },
  today: string,
): ResolvedRange {
  if (isDateString(input.from) && isDateString(input.to) && input.from <= input.to) {
    return {
      from: input.from,
      to: input.to,
      preset: "custom",
      label: formatRangeLabel(input.from, input.to),
    };
  }
  switch (input.period) {
    case "all":
      return { from: null, to: null, preset: "all", label: "Todo o histórico" };
    case "today":
      return { from: today, to: today, preset: "today", label: "Hoje" };
    case "yesterday": {
      const day = shiftCalendarDate(today, -1);
      return { from: day, to: day, preset: "yesterday", label: "Ontem" };
    }
    case "7d":
      return { from: shiftCalendarDate(today, -6), to: today, preset: "7d", label: "Últimos 7 dias" };
    case "90d":
      return { from: shiftCalendarDate(today, -89), to: today, preset: "90d", label: "Últimos 90 dias" };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today, preset: "month", label: "Este mês" };
    default:
      return { from: shiftCalendarDate(today, -29), to: today, preset: "30d", label: "Últimos 30 dias" };
  }
}

export type BestAdRow = {
  adId: string;
  sales: number;
  revenue: number;
  spend: number;
  roas: number | null;
  profit: number;
  /** Métricas secundárias (D-175): null quando indisponível, nunca zero. */
  ctr?: number | null;
  cpc?: number | null;
  checkouts?: number;
  linkClicks?: number;
};

export type BestAdSort =
  | "sales"
  | "revenue"
  | "roas"
  | "profit"
  | "quick"
  | "ctr"
  | "cpc"
  | "initiate"
  | "cost_per_initiate"
  | "clicks";

/** Custo por Initiate Checkout; sem initiate, indisponível (null). */
export function costPerInitiate(row: BestAdRow): number | null {
  const checkouts = row.checkouts ?? 0;
  if (checkouts <= 0) return null;
  return row.spend / checkouts;
}

/** Maior primeiro, com indisponível (null) sempre no fim. */
function descNullLast(value: (row: BestAdRow) => number | null) {
  return (a: BestAdRow, b: BestAdRow) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  };
}

/** Menor primeiro, com indisponível (null) sempre no fim. */
function ascNullLast(value: (row: BestAdRow) => number | null) {
  return (a: BestAdRow, b: BestAdRow) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  };
}

/** Ordena o ranking; desempate por receita e gasto, nesta ordem. */
export function sortBestAds<T extends BestAdRow>(rows: T[], sort: BestAdSort): T[] {
  const bySpend = (a: T, b: T) => b.spend - a.spend;
  const sorted = [...rows];
  switch (sort) {
    case "revenue":
      sorted.sort((a, b) => b.revenue - a.revenue || bySpend(a, b));
      break;
    case "roas":
      sorted.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1) || b.sales - a.sales || bySpend(a, b));
      break;
    case "profit":
      sorted.sort((a, b) => b.profit - a.profit || bySpend(a, b));
      break;
    case "quick":
      // Leitura rápida (D-175): quem chegou mais perto de comprar, depois
      // quem chama mais atenção, depois quem clica mais barato.
      sorted.sort(
        (a, b) =>
          (b.checkouts ?? 0) - (a.checkouts ?? 0) ||
          descNullLast((row) => row.ctr ?? null)(a, b) ||
          ascNullLast((row) => row.cpc ?? null)(a, b) ||
          bySpend(a, b),
      );
      break;
    case "ctr":
      sorted.sort((a, b) => descNullLast((row) => row.ctr ?? null)(a, b) || bySpend(a, b));
      break;
    case "cpc":
      sorted.sort((a, b) => ascNullLast((row) => row.cpc ?? null)(a, b) || bySpend(a, b));
      break;
    case "initiate":
      sorted.sort((a, b) => (b.checkouts ?? 0) - (a.checkouts ?? 0) || bySpend(a, b));
      break;
    case "cost_per_initiate":
      sorted.sort((a, b) => ascNullLast(costPerInitiate)(a, b) || bySpend(a, b));
      break;
    case "clicks":
      sorted.sort((a, b) => (b.linkClicks ?? 0) - (a.linkClicks ?? 0) || bySpend(a, b));
      break;
    default:
      sorted.sort((a, b) => b.sales - a.sales || b.revenue - a.revenue || bySpend(a, b));
  }
  return sorted;
}
