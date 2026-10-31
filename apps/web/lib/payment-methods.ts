/**
 * Métodos de pagamento: agrupamento dos métodos crus das fontes
 * (Lastlink, ConfigCheckout e demais) nos quatro grupos exibidos nos
 * dashboards, e a taxa de aprovação por método.
 *
 * Regra da taxa (docs/METRICAS.md): aprovados divididos pelos
 * pagamentos concluídos do método no período. Concluído é o pagamento
 * que chegou a um desfecho: aprovado, recusado (failed), expirado ou
 * cancelado. Pendente e em análise ficam fora dos dois lados. Sem
 * nenhum concluído, a taxa é indisponível (null), nunca zero.
 */

export type PaymentMethodGroupKey = "pix" | "card" | "boleto" | "other";

export type PaymentMethodGroup = {
  key: PaymentMethodGroupKey;
  label: string;
};

const GROUPS: Record<PaymentMethodGroupKey, PaymentMethodGroup> = {
  pix: { key: "pix", label: "Pix" },
  card: { key: "card", label: "Cartão" },
  boleto: { key: "boleto", label: "Boleto" },
  other: { key: "other", label: "Outros" },
};

function normalizedText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function paymentMethodGroup(
  method: string | null | undefined,
): PaymentMethodGroup {
  const text = normalizedText(method);
  if (text.includes("pix")) return GROUPS.pix;
  if (text.includes("boleto")) return GROUPS.boleto;
  if (
    text.includes("cartao") ||
    text.includes("card") ||
    text.includes("credito") ||
    text.includes("credit") ||
    text.includes("debito") ||
    text.includes("debit")
  ) {
    return GROUPS.card;
  }
  return GROUPS.other;
}

export type MethodSalesRow = {
  method: string | null;
  sales: number;
  revenue: number;
};

export type MethodSalesGroup = PaymentMethodGroup & {
  sales: number;
  revenue: number;
};

export function groupMethodSales(rows: MethodSalesRow[]): MethodSalesGroup[] {
  const byKey = new Map<PaymentMethodGroupKey, MethodSalesGroup>();
  for (const row of rows) {
    const group = paymentMethodGroup(row.method);
    const current =
      byKey.get(group.key) ?? { ...group, sales: 0, revenue: 0 };
    current.sales += row.sales;
    current.revenue += row.revenue;
    byKey.set(group.key, current);
  }
  return [...byKey.values()].sort(
    (a, b) => b.sales - a.sales || b.revenue - a.revenue,
  );
}

export type MethodAttemptRow = {
  method: string | null;
  approved: number;
  concluded: number;
};

export type MethodApprovalGroup = PaymentMethodGroup & {
  approved: number;
  concluded: number;
  rate: number | null;
};

export function approvalRate(
  approved: number,
  concluded: number,
): number | null {
  if (concluded <= 0) return null;
  return (approved / concluded) * 100;
}

export function groupMethodApproval(
  rows: MethodAttemptRow[],
): MethodApprovalGroup[] {
  const byKey = new Map<
    PaymentMethodGroupKey,
    { group: PaymentMethodGroup; approved: number; concluded: number }
  >();
  for (const row of rows) {
    const group = paymentMethodGroup(row.method);
    const current =
      byKey.get(group.key) ?? { group, approved: 0, concluded: 0 };
    current.approved += row.approved;
    current.concluded += row.concluded;
    byKey.set(group.key, current);
  }
  return [...byKey.values()]
    .map((row) => ({
      ...row.group,
      approved: row.approved,
      concluded: row.concluded,
      rate: approvalRate(row.approved, row.concluded),
    }))
    .sort((a, b) => b.concluded - a.concluded);
}
