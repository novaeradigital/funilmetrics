import { describe, expect, it } from "vitest";
import {
  advanceOrderStatus,
  advancePaymentStatus,
  calculateFinancialEffect,
} from "./lastlink-processor.js";

describe("processamento financeiro Lastlink", () => {
  it("zera qualquer efeito de dados de teste ou escopo desconhecido", () => {
    for (const scope of ["test", "unknown"] as const) {
      expect(
        calculateFinancialEffect({
          scope,
          intent: "approve",
          amount: 100,
          hasExternalPaymentId: true,
          existingPositive: 0,
          existingNegative: 0,
        }),
      ).toEqual({ effect: 0, duplicate: false });
    }
  });

  it("aplica aprovação e somente a primeira reversão em produção", () => {
    expect(
      calculateFinancialEffect({
        scope: "production",
        intent: "approve",
        amount: 100,
        hasExternalPaymentId: true,
        existingPositive: 0,
        existingNegative: 0,
      }),
    ).toEqual({ effect: 100, duplicate: false });

    expect(
      calculateFinancialEffect({
        scope: "production",
        intent: "reverse",
        amount: 100,
        hasExternalPaymentId: true,
        existingPositive: 100,
        existingNegative: 0,
      }),
    ).toEqual({ effect: -100, duplicate: false });

    expect(
      calculateFinancialEffect({
        scope: "production",
        intent: "reverse",
        amount: 100,
        hasExternalPaymentId: true,
        existingPositive: 100,
        existingNegative: -100,
      }),
    ).toEqual({ effect: 0, duplicate: true });
  });

  it("não gera efeito financeiro sem identificador externo de pagamento", () => {
    expect(
      calculateFinancialEffect({
        scope: "production",
        intent: "approve",
        amount: 100,
        hasExternalPaymentId: false,
        existingPositive: 0,
        existingNegative: 0,
      }),
    ).toEqual({ effect: 0, duplicate: false });
  });

  it("não deixa eventos antigos regredirem o estado consolidado", () => {
    expect(advanceOrderStatus("approved", "pending")).toBe("approved");
    expect(advancePaymentStatus("refunded", "approved")).toBe("refunded");
    expect(advancePaymentStatus("approved", "refund_requested")).toBe(
      "refund_requested",
    );
  });
});
