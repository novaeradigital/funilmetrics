import { describe, expect, it } from "vitest";
import {
  metaPixelSettings,
  metaPixelSettingsDefaults,
} from "./meta-pixels";

describe("metaPixelSettings", () => {
  it("devolve os padroes quando nao ha configuracao", () => {
    expect(metaPixelSettings(null)).toEqual(metaPixelSettingsDefaults);
    expect(metaPixelSettings(undefined)).toEqual(metaPixelSettingsDefaults);
    expect(metaPixelSettings("texto")).toEqual(metaPixelSettingsDefaults);
  });

  it("respeita os interruptores salvos e ignora tipos errados", () => {
    const settings = metaPixelSettings({
      events: { purchase: false, pageView: "sim" },
      matching: { email: false },
      valueRule: "percent",
      valuePercent: 80,
      contentIdsType: "sku",
      blockIps: ["1.2.3.4", "", 42],
    });
    expect(settings.events.purchase).toBe(false);
    expect(settings.events.pageView).toBe(true);
    expect(settings.matching.email).toBe(false);
    expect(settings.matching.phone).toBe(true);
    expect(settings.valueRule).toBe("percent");
    expect(settings.valuePercent).toBe(80);
    expect(settings.contentIdsType).toBe("sku");
    expect(settings.blockIps).toEqual(["1.2.3.4"]);
  });

  it("rejeita regra de valor e content_ids fora da lista", () => {
    const settings = metaPixelSettings({
      valueRule: "dobro",
      contentIdsType: "nome",
      valueFixed: -5,
    });
    expect(settings.valueRule).toBe("paid");
    expect(settings.contentIdsType).toBe("product");
    expect(settings.valueFixed).toBeNull();
  });
});
