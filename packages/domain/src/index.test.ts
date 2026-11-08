import { describe, expect, it } from "vitest";
import { creativeDisplayNameFromFileName, initialRoles, PRODUCT_NAME } from "./index.js";

describe("domínio compartilhado", () => {
  it("expõe o nome oficial do produto", () => {
    expect(PRODUCT_NAME).toBe("Funil Metrics");
  });

  it("mantém os papéis iniciais aprovados", () => {
    expect(initialRoles).toEqual([
      "owner",
      "administrator",
      "editor",
      "analyst",
      "viewer",
    ]);
  });
});

describe("política de mídia",()=>{
  it("mantém limites aprovados na versão 1",async()=>{
    const {CREATIVE_MEDIA_POLICY_V1}=await import("./index");
    expect(CREATIVE_MEDIA_POLICY_V1.version).toBe("creative_media_import_v1");
    expect(CREATIVE_MEDIA_POLICY_V1.formats["image/png"].maxBytes).toBe(50*1024**2);
    expect(CREATIVE_MEDIA_POLICY_V1.formats["video/mp4"].maxBytes).toBe(2*1024**3);
    expect(CREATIVE_MEDIA_POLICY_V1.formats["text/plain"].maxBytes).toBe(10*1024**2);
    expect(CREATIVE_MEDIA_POLICY_V1.execution.maxFiles).toBe(1_000);
    expect(CREATIVE_MEDIA_POLICY_V1.execution.maxBytes).toBe(20*1024**3);
  });
});

describe("nome de exibição do criativo", () => {
  it("nasce sem a extensão do arquivo", () => {
    expect(creativeDisplayNameFromFileName("ad-fabio.mp4")).toBe("ad-fabio");
    expect(creativeDisplayNameFromFileName("foto.PNG")).toBe("foto");
  });

  it("tira só a extensão final", () => {
    expect(creativeDisplayNameFromFileName("ad.final.v2.mp4")).toBe("ad.final.v2");
  });

  it("mantém o nome quando não há extensão ou ela esvaziaria o nome", () => {
    expect(creativeDisplayNameFromFileName("arquivo")).toBe("arquivo");
    expect(creativeDisplayNameFromFileName(".mp4")).toBe(".mp4");
  });
});
