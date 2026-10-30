/**
 * Dashboard Inteligente — regras puras da visão por anúncio.
 *
 * A visão cruza vendas (Lastlink) com gasto (Meta Ads) pelo ID exato do
 * anúncio, que chega na venda dentro de `utm_content` quando o anúncio roda
 * com `utm_content={{ad.id}}`. As fórmulas seguem docs/METRICAS.md e a
 * decisão D-137 em docs/DECISOES.md: métrica derivada com denominador zero
 * é indisponível (null), nunca zero fabricado.
 */

const AD_ID_PATTERN = /^\d{5,25}$/;

/**
 * Extrai o ID do anúncio de um `utm_content` bruto.
 * Aceita o ID limpo ou pacotes compostos separados por caracteres não
 * numéricos (ex.: "campanha_120345678901234"), escolhendo o último trecho
 * numérico válido — mesma régua do cruzamento por ID exato.
 * Retorna null quando não há ID de anúncio confiável (venda orgânica).
 */
export function extractAdId(utmContent: string | null | undefined): string | null {
  if (!utmContent) return null;
  const trimmed = utmContent.trim();
  if (AD_ID_PATTERN.test(trimmed)) return trimmed;
  const segments = trimmed.split(/[^\d]+/).filter((part) => AD_ID_PATTERN.test(part));
  const last = segments[segments.length - 1];
  return last ?? null;
}

/** DDD brasileiro → UF (tabela pública de códigos de área). */
export const DDD_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP",
  "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "64": "GO", "63": "TO",
  "65": "MT", "66": "MT", "67": "MS", "68": "AC", "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA", "79": "SE",
  "81": "PE", "87": "PE", "82": "AL", "83": "PB", "84": "RN",
  "85": "CE", "88": "CE", "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA", "96": "AP", "92": "AM", "97": "AM", "95": "RR",
  "98": "MA", "99": "MA",
};

/**
 * Deriva a UF do comprador pelo DDD do telefone.
 * A Lastlink não envia cidade/UF do comprador; o telefone vem em todas as
 * vendas. É uma estimativa (o DDD é do número, não do endereço) e a tela
 * rotula o bloco de regiões dessa forma.
 */
export function dddToUf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (digits.length < 10) return null;
  const ddd = digits.slice(0, 2);
  return DDD_UF[ddd] ?? null;
}

export type CrossTotals = {
  revenue: number;
  spend: number;
  sales: number;
};

export type DerivedMetrics = {
  profit: number;
  roas: number | null;
  cpa: number | null;
  ticket: number | null;
};

/** Métricas derivadas do cruzamento vendas × gasto. */
export function computeDerived(totals: CrossTotals): DerivedMetrics {
  const { revenue, spend, sales } = totals;
  return {
    profit: revenue - spend,
    roas: spend > 0 ? revenue / spend : null,
    cpa: sales > 0 ? spend / sales : null,
    ticket: sales > 0 ? revenue / sales : null,
  };
}

/** Variação percentual contra o período anterior; null quando não comparável. */
export function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
