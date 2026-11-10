import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  evaluateCreative,
  verdictCounts,
  type CreativeMetrics,
} from "./intelligence-rules";

function base(overrides: Partial<CreativeMetrics>): CreativeMetrics {
  return {
    creativeId: "c1",
    spend: 300,
    sales: 0,
    revenue: 0,
    impressions: 10000,
    reach: 4000,
    linkClicks: 100,
    views3s: 4000,
    thruplay: 2000,
    roas: null,
    ctr: 1,
    ctrFirstHalf: 1,
    ctrSecondHalf: 1,
    frequency: 2.5,
    hookRate: 40,
    thruRate: 50,
    missingAccounts: [],
    ...overrides,
  };
}

describe("motor de regras da Inteligencia", () => {
  it("escalar: ROAS acima da meta, vendas suficientes e sem fadiga", () => {
    const v = evaluateCreative(
      base({ sales: 5, revenue: 900, roas: 3, spend: 300, frequency: 1.8 }),
      DEFAULT_THRESHOLDS,
    );
    expect(v.map((x) => x.kind)).toContain("escalar");
    expect(v.find((x) => x.kind === "escalar")?.rule).toContain("ROAS");
  });

  it("duplicar: vende bem com frequencia alta e CTR em queda", () => {
    const v = evaluateCreative(
      base({
        sales: 4,
        revenue: 700,
        roas: 2.4,
        frequency: 3.4,
        ctrFirstHalf: 2,
        ctrSecondHalf: 1.2,
      }),
      DEFAULT_THRESHOLDS,
    );
    expect(v.map((x) => x.kind)).toContain("duplicar");
    expect(v.map((x) => x.kind)).not.toContain("escalar");
  });

  it("outra conta: provado e ausente em outra conta ativa do projeto", () => {
    const v = evaluateCreative(
      base({
        sales: 6,
        revenue: 500,
        roas: 1.2,
        missingAccounts: [{ id: "a2", name: "Saoliveira 02" }],
      }),
      DEFAULT_THRESHOLDS,
    );
    const hit = v.find((x) => x.kind === "outra_conta");
    expect(hit?.rule).toContain("Saoliveira 02");
  });

  it("novo gancho: corpo converte e gancho segura pouco", () => {
    const v = evaluateCreative(
      base({ sales: 2, revenue: 600, roas: 2, hookRate: 15, thruRate: 20 }),
      DEFAULT_THRESHOLDS,
    );
    expect(v.map((x) => x.kind)).toContain("novo_gancho");
  });

  it("mesmo gancho: gancho forte e nenhum clique vira venda", () => {
    const v = evaluateCreative(
      base({ sales: 0, spend: 50, hookRate: 38, linkClicks: 60 }),
      DEFAULT_THRESHOLDS,
    );
    expect(v.map((x) => x.kind)).toContain("mesmo_gancho");
    expect(v.map((x) => x.kind)).not.toContain("aposentar");
  });

  it("aposentar: gasto de 2x o CPA alvo sem venda", () => {
    const v = evaluateCreative(
      base({ sales: 0, spend: 250, hookRate: 10, linkClicks: 5 }),
      DEFAULT_THRESHOLDS,
    );
    expect(v.map((x) => x.kind)).toContain("aposentar");
  });

  it("sem dado nao dispara: metricas nulas nao viram veredito", () => {
    const v = evaluateCreative(
      base({
        sales: 0,
        spend: 0,
        roas: null,
        views3s: null,
        hookRate: null,
        thruRate: null,
        impressions: 0,
      }),
      DEFAULT_THRESHOLDS,
    );
    expect(v).toHaveLength(0);
  });

  it("contagem dos cartoes agrega renovar (novo gancho + mesmo gancho + aposentar)", () => {
    const counts = verdictCounts([
      [{ kind: "escalar", rule: "" }],
      [
        { kind: "novo_gancho", rule: "" },
        { kind: "aposentar", rule: "" },
      ],
      [{ kind: "outra_conta", rule: "" }],
    ]);
    expect(counts).toEqual({ escalar: 1, duplicar: 0, outraConta: 1, renovar: 1 });
  });
});
