import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ConfigCheckoutNormalizationBlocked,
  normalizeConfigCheckoutEvent,
} from "./configcheckout-normalizer.js";

async function fixture(name: string) {
  const url = new URL(
    `../../../docs/payloads/configcheckout/${name}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-teste",
    type: "payment.confirmed",
    version: 1,
    occurred_at: "2026-10-30T09:12:44-03:00",
    test: false,
    seller: { id: 42 },
    order: {
      token: "token-pedido-1",
      status: "pago",
      created_at: "2026-10-30T09:10:02-03:00",
      paid_at: "2026-10-30T09:12:44-03:00",
      method: "pix",
      installments: 1,
      amounts: { subtotal: "197.00", total: "197.00" },
      gateway: { name: "appmax", payment_id: "456789" },
      product: { id: 7, name: "Produto Exemplo", sku: "PROD-EXEMPLO" },
      buyer: {
        name: "Compradora Exemplo",
        email: "anon@example.test",
        phone: "+5511999999999",
        document: "123.456.789-09",
      },
    },
    ...overrides,
  };
}

describe("normalizeConfigCheckoutEvent", () => {
  it("normaliza o fixture de pagamento confirmado como payment_approved", async () => {
    const result = normalizeConfigCheckoutEvent({
      rawEventId: "raw-1",
      externalEventId: "evt-1",
      idempotencyKey: "key-1",
      receivedAt: new Date("2026-10-30T12:15:00Z"),
      body: await fixture("payment_confirmed.json"),
    });

    expect(result.normalizedType).toBe("payment_approved");
    expect(result.scope).toBe("test");
    expect(result.orderExternalKey).toBe("7c1a2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
    expect(result.paidAmount).toBe(197);
    expect(result.originalAmount).toBe(197);
    expect(result.occurredAtBasis).toBe("payment_date");
    expect(result.offer.externalId).toBe("checkout:3");
    expect(result.products).toEqual([
      { externalId: "7", name: "Produto Exemplo" },
    ]);
    expect(result.attribution.utmContent).toBe("120254537292430667");
    expect(result.attribution.originUrl).toBe("https://pay.exemplo.com");
    expect(result.person.identifiers.map((item) => item.type)).toEqual([
      "email",
      "phone",
      "document",
    ]);
  });

  it("pedido criado vira payment_pending sem efeito financeiro", () => {
    const result = normalizeConfigCheckoutEvent({
      rawEventId: "raw-2",
      externalEventId: "evt-2",
      idempotencyKey: "key-2",
      receivedAt: new Date("2026-10-30T12:15:00Z"),
      body: envelope({ type: "order.created" }),
    });

    expect(result.normalizedType).toBe("payment_pending");
    expect(result.financialIntent).toBe("none");
    expect(result.scope).toBe("production");
    expect(result.occurredAtBasis).toBe("created_at");
  });

  it("estorno vira payment_refunded com intenção de reversão", () => {
    const result = normalizeConfigCheckoutEvent({
      rawEventId: "raw-3",
      externalEventId: "evt-3",
      idempotencyKey: "key-3",
      receivedAt: new Date("2026-10-30T12:15:00Z"),
      body: envelope({ type: "order.refunded" }),
    });

    expect(result.normalizedType).toBe("payment_refunded");
    expect(result.financialIntent).toBe("reverse");
    expect(result.warnings).toContain("producer_commission_missing");
  });

  it("sem a marca de teste o escopo fica desconhecido e o efeito é bloqueado", () => {
    const body = envelope();
    delete (body as Record<string, unknown>).test;
    const result = normalizeConfigCheckoutEvent({
      rawEventId: "raw-4",
      externalEventId: "evt-4",
      idempotencyKey: "key-4",
      receivedAt: new Date("2026-10-30T12:15:00Z"),
      body,
    });

    expect(result.scope).toBe("unknown");
    expect(result.warnings).toContain(
      "is_test_missing_financial_effect_blocked",
    );
  });

  it("bloqueia evento desconhecido", () => {
    expect(() =>
      normalizeConfigCheckoutEvent({
        rawEventId: "raw-5",
        externalEventId: "evt-5",
        idempotencyKey: "key-5",
        receivedAt: new Date("2026-10-30T12:15:00Z"),
        body: envelope({ type: "order.shipped" }),
      }),
    ).toThrow(ConfigCheckoutNormalizationBlocked);
  });

  it("bloqueia pedido sem e-mail do comprador", () => {
    const body = envelope();
    (body.order as Record<string, unknown>).buyer = { name: "Sem e-mail" };
    expect(() =>
      normalizeConfigCheckoutEvent({
        rawEventId: "raw-6",
        externalEventId: "evt-6",
        idempotencyKey: "key-6",
        receivedAt: new Date("2026-10-30T12:15:00Z"),
        body,
      }),
    ).toThrow(ConfigCheckoutNormalizationBlocked);
  });
});
