import { describe, expect, it } from "vitest";
import {
  approvalRate,
  groupMethodApproval,
  groupMethodSales,
  paymentMethodGroup,
} from "./payment-methods";

describe("paymentMethodGroup", () => {
  it.each([
    ["pix", "pix"],
    ["PIX", "pix"],
    ["credit_card", "card"],
    ["cartao", "card"],
    ["cartão_crédito", "card"],
    ["debit_card", "card"],
    ["boleto", "boleto"],
    ["boleto_bancario", "boleto"],
    ["apple_pay", "other"],
    ["", "other"],
    [null, "other"],
  ])("%s cai no grupo %s", (method, key) => {
    expect(paymentMethodGroup(method as string | null).key).toBe(key);
  });
});

describe("groupMethodSales", () => {
  it("soma métodos crus no mesmo grupo e ordena por vendas", () => {
    const groups = groupMethodSales([
      { method: "pix", sales: 10, revenue: 1000 },
      { method: "credit_card", sales: 4, revenue: 900 },
      { method: "cartao", sales: 3, revenue: 600 },
      { method: "boleto", sales: 1, revenue: 100 },
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "pix",
      "card",
      "boleto",
    ]);
    expect(groups[1]).toMatchObject({ sales: 7, revenue: 1500 });
  });
});

describe("approvalRate", () => {
  it("sem concluídos a taxa é indisponível", () => {
    expect(approvalRate(0, 0)).toBeNull();
  });

  it("calcula o percentual de aprovados sobre concluídos", () => {
    expect(approvalRate(4, 7)).toBeCloseTo(57.14, 1);
    expect(approvalRate(5, 5)).toBe(100);
  });
});

describe("groupMethodApproval", () => {
  it("agrupa tentativas e deriva a taxa por grupo", () => {
    const groups = groupMethodApproval([
      { method: "pix", approved: 4, concluded: 7 },
      { method: "credit_card", approved: 5, concluded: 5 },
    ]);

    expect(groups[0]).toMatchObject({ key: "pix", approved: 4, concluded: 7 });
    expect(groups[0]?.rate).toBeCloseTo(57.14, 1);
    expect(groups[1]).toMatchObject({ key: "card", rate: 100 });
  });
});
