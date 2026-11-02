import { describe, expect, it } from "vitest";
import {
  buildDestinationUrl,
  buildUtmQuery,
  expandStructure,
  resolveNamingPattern,
  unknownPatternVariables,
} from "./campaign-naming";

const ctx = {
  criativo: "video-depoimento-ana.mp4",
  produto: "TikTok Shop Express",
  data: new Date(2026, 10, 2),
  sequencia: 7,
  formato: "video",
  pais: "BR",
};

describe("resolveNamingPattern", () => {
  it("resolve variaveis e junta com o separador", () => {
    expect(resolveNamingPattern("{produto} | {criativo} | {data}", ctx))
      .toBe("TikTok Shop Express_video-depoimento-ana.mp4_20261102");
  });
  it("aplica caixa e sequencia com zeros", () => {
    expect(resolveNamingPattern("{pais} | {sequencia}", ctx, { casing: "upper" }))
      .toBe("BR_007");
  });
  it("descarta partes vazias sem duplicar o separador", () => {
    expect(resolveNamingPattern("{produto} | {publico} | {formato}", ctx))
      .toBe("TikTok Shop Express_video");
  });
  it("le variavel de arquivo", () => {
    expect(resolveNamingPattern("{arquivo:lote}", { ...ctx, arquivo: { lote: "L42" } }))
      .toBe("L42");
  });
  it("marca variaveis desconhecidas", () => {
    expect(unknownPatternVariables("{produto} | {cidade}")).toEqual(["cidade"]);
  });
});

describe("UTMs", () => {
  it("monta a query com variaveis resolvidas", () => {
    const query = buildUtmQuery(
      { utm_source: "facebook", utm_medium: "cpc", utm_content: "{criativo}" }, ctx);
    expect(query).toContain("utm_source=facebook");
    expect(query).toContain("utm_content=video-depoimento-ana.mp4");
  });
  it("monta a URL final", () => {
    expect(buildDestinationUrl("https://exemplo.com/pagina", { utm_source: "facebook" }, ctx))
      .toBe("https://exemplo.com/pagina?utm_source=facebook");
  });
});

describe("expandStructure", () => {
  it("1-3-1 com 3 criativos em rodizio", () => {
    const slots = expandStructure(
      { campaigns: 1, adSetsPerCampaign: 3, adsPerAdSet: 1, duplications: 1, distribution: "rotate" }, 3);
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.creativeIndex)).toEqual([0, 1, 2]);
  });
  it("duplicacao repete a estrutura inteira", () => {
    const slots = expandStructure(
      { campaigns: 1, adSetsPerCampaign: 1, adsPerAdSet: 1, duplications: 2, distribution: "rotate" }, 1);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.campaignIndex)).toEqual([0, 1]);
  });
});
