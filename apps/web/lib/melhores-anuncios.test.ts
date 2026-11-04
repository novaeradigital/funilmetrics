import { describe, expect, it } from "vitest";
import {
  bodyRate,
  formatRangeLabel,
  hookRate,
  resolveDateRange,
  retentionDiagnosis,
  retentionLevel,
  sortBestAds,
  stageRate,
  type BestAdRow,
} from "./melhores-anuncios";

describe("resolveDateRange", () => {
  const today = "2026-11-01";

  it("o padrão é Últimos 30 dias terminando hoje", () => {
    expect(resolveDateRange({}, today)).toEqual({
      from: "2026-10-03",
      to: "2026-11-01",
      preset: "30d",
      label: "Últimos 30 dias",
    });
  });

  it("resolve os presets nomeados", () => {
    expect(resolveDateRange({ period: "today" }, today).from).toBe("2026-11-01");
    expect(resolveDateRange({ period: "yesterday" }, today)).toMatchObject({
      from: "2026-10-31",
      to: "2026-10-31",
    });
    expect(resolveDateRange({ period: "7d" }, today).from).toBe("2026-10-26");
    expect(resolveDateRange({ period: "month" }, today)).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-01",
      label: "Este mês",
    });
    expect(resolveDateRange({ period: "all" }, today)).toMatchObject({ from: null, to: null });
  });

  it("intervalo explícito válido vence o preset", () => {
    const range = resolveDateRange({ from: "2026-10-01", to: "2026-10-30", period: "7d" }, today);
    expect(range.preset).toBe("custom");
    expect(range.from).toBe("2026-10-01");
    expect(range.to).toBe("2026-10-30");
  });

  it("intervalo inválido ou invertido cai no padrão", () => {
    expect(resolveDateRange({ from: "2026-10-30", to: "2026-10-01" }, today).preset).toBe("30d");
    expect(resolveDateRange({ from: "ontem", to: "hoje" }, today).preset).toBe("30d");
  });

  it("formata o rótulo do intervalo", () => {
    expect(formatRangeLabel("2026-10-01", "2026-10-01")).toBe("1 de out. de 2026");
    expect(formatRangeLabel("2026-10-01", "2026-10-30")).toBe("1 de out. de 2026 a 30 de out. de 2026");
  });
});

describe("hookRate e bodyRate", () => {
  it("calcula as taxas em percentual", () => {
    expect(hookRate(300, 1000)).toBe(30);
    expect(bodyRate(150, 300)).toBe(50);
  });

  it("retorna null sem dado de vídeo ou sem denominador", () => {
    expect(hookRate(null, 1000)).toBeNull();
    expect(hookRate(300, 0)).toBeNull();
    expect(bodyRate(null, 300)).toBeNull();
    expect(bodyRate(150, null)).toBeNull();
    expect(bodyRate(150, 0)).toBeNull();
  });
});

describe("retentionLevel", () => {
  it("classifica contra a régua de 30 e o piso de 20", () => {
    expect(retentionLevel(30)).toBe("good");
    expect(retentionLevel(45)).toBe("good");
    expect(retentionLevel(20)).toBe("warn");
    expect(retentionLevel(29.9)).toBe("warn");
    expect(retentionLevel(19.9)).toBe("bad");
    expect(retentionLevel(null)).toBeNull();
  });
});

describe("stageRate", () => {
  it("calcula a passagem e protege o denominador", () => {
    expect(stageRate(50, 200)).toBe(25);
    expect(stageRate(10, 0)).toBeNull();
  });
});

describe("retentionDiagnosis", () => {
  it("cobre os quatro quadrantes hook × body", () => {
    expect(retentionDiagnosis(35, 40)).toContain("depois do vídeo");
    expect(retentionDiagnosis(35, 10)).toContain("não entrega");
    expect(retentionDiagnosis(10, 40)).toContain("3 primeiros segundos");
    expect(retentionDiagnosis(10, 10)).toContain("aposentar");
    expect(retentionDiagnosis(null, 40)).toBeNull();
    expect(retentionDiagnosis(35, null)).toBeNull();
  });
});

describe("sortBestAds", () => {
  const rows: BestAdRow[] = [
    { adId: "a", sales: 5, revenue: 500, spend: 100, roas: 5, profit: 400 },
    { adId: "b", sales: 9, revenue: 300, spend: 200, roas: 1.5, profit: 100 },
    { adId: "c", sales: 9, revenue: 900, spend: 50, roas: null, profit: 850 },
  ];

  it("ordena por vendas com desempate por receita", () => {
    expect(sortBestAds(rows, "sales").map((row) => row.adId)).toEqual(["c", "b", "a"]);
  });

  it("ordena por ROAS tratando null como menor", () => {
    expect(sortBestAds(rows, "roas").map((row) => row.adId)).toEqual(["a", "b", "c"]);
  });

  it("ordena por lucro e por receita", () => {
    expect(sortBestAds(rows, "profit").map((row) => row.adId)).toEqual(["c", "a", "b"]);
    expect(sortBestAds(rows, "revenue").map((row) => row.adId)).toEqual(["c", "a", "b"]);
  });

  it("não muta o array original", () => {
    const original = [...rows];
    sortBestAds(rows, "profit");
    expect(rows).toEqual(original);
  });
});

describe("sortBestAds métricas secundárias (D-175)", () => {
  const rows: BestAdRow[] = [
    { adId: "a", sales: 0, revenue: 0, spend: 100, roas: null, profit: -100, ctr: 2, cpc: 1, checkouts: 4, linkClicks: 100 },
    { adId: "b", sales: 0, revenue: 0, spend: 200, roas: null, profit: -200, ctr: 5, cpc: 0.5, checkouts: 4, linkClicks: 400 },
    { adId: "c", sales: 0, revenue: 0, spend: 50, roas: null, profit: -50, ctr: null, cpc: null, checkouts: 0, linkClicks: 0 },
    { adId: "d", sales: 0, revenue: 0, spend: 80, roas: null, profit: -80, ctr: 1, cpc: 2, checkouts: 9, linkClicks: 40 },
  ];

  it("CTR ordena do maior pro menor e manda indisponível pro fim", () => {
    expect(sortBestAds(rows, "ctr").map((row) => row.adId)).toEqual(["b", "a", "d", "c"]);
  });

  it("CPC ordena do menor pro maior e manda indisponível pro fim", () => {
    expect(sortBestAds(rows, "cpc").map((row) => row.adId)).toEqual(["b", "a", "d", "c"]);
  });

  it("Initiate ordena por quantidade de checkouts iniciados", () => {
    expect(sortBestAds(rows, "initiate").map((row) => row.adId)).toEqual(["d", "b", "a", "c"]);
  });

  it("Custo por Initiate ordena do menor pro maior e sem initiate vai pro fim", () => {
    // d: 80/9 = 8,9; a: 100/4 = 25; b: 200/4 = 50; c: sem initiate.
    expect(sortBestAds(rows, "cost_per_initiate").map((row) => row.adId)).toEqual(["d", "a", "b", "c"]);
  });

  it("Cliques ordena por cliques no link", () => {
    expect(sortBestAds(rows, "clicks").map((row) => row.adId)).toEqual(["b", "a", "d", "c"]);
  });

  it("Leitura rápida: initiate, depois CTR, depois CPC, depois gasto", () => {
    // d tem mais initiates (9); entre a e b (4), b tem CTR maior.
    expect(sortBestAds(rows, "quick").map((row) => row.adId)).toEqual(["d", "b", "a", "c"]);
  });
});
