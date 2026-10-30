import { describe, expect, it } from "vitest";
import { computeDerived, dddToUf, deltaPercent, extractAdId } from "./dashboard-inteligente";

describe("extractAdId", () => {
  it("aceita o ID limpo vindo de {{ad.id}}", () => {
    expect(extractAdId("120345678901234")).toBe("120345678901234");
  });

  it("extrai o ID de pacote composto escolhendo o último trecho válido", () => {
    expect(extractAdId("lancamento_x_120345678901234")).toBe("120345678901234");
    expect(extractAdId("ig|social|120345678901234")).toBe("120345678901234");
  });

  it("rejeita valores que não são ID de anúncio", () => {
    expect(extractAdId("organico")).toBeNull();
    expect(extractAdId("123")).toBeNull();
    expect(extractAdId("")).toBeNull();
    expect(extractAdId(null)).toBeNull();
    expect(extractAdId(undefined)).toBeNull();
  });
});

describe("dddToUf", () => {
  it("deriva a UF de telefone com código do país", () => {
    expect(dddToUf("+5531994420840")).toBe("MG");
    expect(dddToUf("5511987654321")).toBe("SP");
  });

  it("deriva a UF de telefone sem código do país", () => {
    expect(dddToUf("85999887766")).toBe("CE");
    expect(dddToUf("(41) 3222-1234")).toBe("PR");
  });

  it("retorna null para telefone ausente ou DDD desconhecido", () => {
    expect(dddToUf(null)).toBeNull();
    expect(dddToUf("08007777000")).toBeNull();
    expect(dddToUf("123")).toBeNull();
  });
});

describe("computeDerived", () => {
  it("calcula lucro, ROAS, CPA e ticket do cruzamento", () => {
    const derived = computeDerived({ revenue: 18069.95, spend: 1710.35, sales: 35 });
    expect(derived.profit).toBeCloseTo(16359.6);
    expect(derived.roas).toBeCloseTo(10.56, 1);
    expect(derived.cpa).toBeCloseTo(48.87);
    expect(derived.ticket).toBeCloseTo(516.28);
  });

  it("marca métrica sem denominador como indisponível, nunca zero", () => {
    const derived = computeDerived({ revenue: 500, spend: 0, sales: 0 });
    expect(derived.roas).toBeNull();
    expect(derived.cpa).toBeNull();
    expect(derived.ticket).toBeNull();
    expect(derived.profit).toBe(500);
  });
});

describe("deltaPercent", () => {
  it("calcula a variação contra o período anterior", () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(80, 100)).toBe(-20);
  });

  it("retorna null quando o período anterior é zero", () => {
    expect(deltaPercent(10, 0)).toBeNull();
  });
});
