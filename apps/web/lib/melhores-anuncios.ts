/**
 * Melhores anúncios: regras puras da tela (D-160).
 *
 * O ranking cruza gasto e comportamento da Meta com as vendas reais
 * atribuídas ao anúncio (ID no utm_content da venda, mesma régua do
 * Dashboard Inteligente). As definições seguem docs/METRICAS.md:
 * métrica derivada com denominador zero ou dado ausente é indisponível
 * (null), nunca zero fabricado.
 */

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

export type BestAdRow = {
  adId: string;
  sales: number;
  revenue: number;
  spend: number;
  roas: number | null;
  profit: number;
};

export type BestAdSort = "sales" | "revenue" | "roas" | "profit";

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
    default:
      sorted.sort((a, b) => b.sales - a.sales || b.revenue - a.revenue || bySpend(a, b));
  }
  return sorted;
}
