import { describe, expect, it } from "vitest";
import {
  buildDestinationUrl,
  buildUtmQuery,
  DEFAULT_UTM_PARAMS,
  expandStructure,
  legacyUtmsToParams,
  formatAgeRange,
  genderLabel,
  resolveNamingPattern,
  resolveUtmParams,
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

describe("Parametros UTMs (campo unico)", () => {
  it("o padrao novo passa literal, com as macros da Meta intactas", () => {
    expect(resolveUtmParams(DEFAULT_UTM_PARAMS, ctx)).toBe(DEFAULT_UTM_PARAMS);
  });
  it("resolve variaveis do Funil sem tocar nas macros", () => {
    expect(resolveUtmParams("utm_content={criativo}|{{ad.id}}&utm_campaign={campanha}", { ...ctx, campanha: "Campanha BR" }))
      .toBe("utm_content=video-depoimento-ana.mp4|{{ad.id}}&utm_campaign=Campanha BR");
  });
  it("converte o formato antigo de 5 campos na string unica", () => {
    expect(legacyUtmsToParams({ utm_source: "facebook", utm_medium: "cpc", utm_campaign: "{campanha}", utm_content: "{criativo}", utm_term: "" }))
      .toBe("utm_source=facebook&utm_medium=cpc&utm_campaign={campanha}&utm_content={criativo}");
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

describe("variaveis do assistente (D-184)", () => {
  it("resolve pagina pelo nome, idade aberta e genero", () => {
    const ctx = { criativo: "video camisa branca", data: new Date(2026, 10, 8), pagina: "Instituto Inti", pais: "BR", idade: formatAgeRange(25, 65), genero: genderLabel("all") };
    expect(resolveNamingPattern("{criativo} | {data} | {pagina}", ctx, { separator: " | " })).toBe("video camisa branca | 20261108 | Instituto Inti");
    expect(resolveNamingPattern("{idade} | {genero} | {pais}", ctx, { separator: " | " })).toBe("25+ | Todos | BR");
  });
  it("idade fechada e rotulos de genero", () => {
    expect(formatAgeRange(25, 44)).toBe("25-44");
    expect(genderLabel("female")).toBe("Feminino");
    expect(genderLabel("male")).toBe("Masculino");
  });
  it("padrao antigo com {produto} resolve vazio sem quebrar", () => {
    expect(resolveNamingPattern("{produto} | {pais}", { pais: "BR" }, { separator: " | " })).toBe("BR");
  });
  it("{data} em dd/mm/aa com ano de 2 digitos", () => {
    const ctx = { criativo: "video camisa branca", data: new Date(2026, 10, 8), pagina: "Instituto Inti" };
    expect(resolveNamingPattern("{criativo} | {data} | {pagina}", ctx, { separator: " | ", dateFormat: "DD/MM/YY" })).toBe("video camisa branca | 08/11/26 | Instituto Inti");
    expect(resolveNamingPattern("{data}", { data: new Date(2027, 0, 5) }, { dateFormat: "DD/MM/YY" })).toBe("05/01/27");
  });
});
