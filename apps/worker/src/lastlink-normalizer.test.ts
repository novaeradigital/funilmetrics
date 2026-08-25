import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LastlinkNormalizationBlocked,
  normalizeLastlinkEvent,
} from "./lastlink-normalizer.js";

const fixtures = [
  ["abandoned_cart.json", "checkout_abandoned"],
  ["purchase_request_confirmed.json", "payment_pending"],
  ["purchase_order_confirmed.json", "payment_approved"],
  ["purchase_request_expired.json", "payment_request_expired"],
  ["purchase_request_canceled.json", "payment_request_cancelled"],
  ["refund_requested.json", "refund_requested"],
  ["payment_refund.json", "payment_refunded"],
  ["payment_chargeback.json", "payment_chargeback"],
] as const;

async function fixture(name: string) {
  const url = new URL(
    `../../../docs/payloads/lastlink/${name}`,
    import.meta.url,
  );
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

describe("normalizeLastlinkEvent", () => {
  it.each(fixtures)("normaliza %s como %s", async (name, expectedType) => {
    const result = normalizeLastlinkEvent({
      rawEventId: `raw-${name}`,
      externalEventId: `external-${name}`,
      idempotencyKey: `key-${name}`,
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: await fixture(name),
    });

    expect(result.normalizedType).toBe(expectedType);
    expect(result.scope).toBe("test");
    expect(result.products).toHaveLength(1);
    expect(result.attribution).toMatchObject({
      utmSource: "utm_source",
      utmMedium: "utm_medium",
      utmCampaign: "utm_campaign",
      src: "blog",
      sck: "form_button",
      vtid: "00001-000002-000102",
    });
  });

  it("mantém todos os produtos recebidos", () => {
    const result = normalizeLastlinkEvent({
      rawEventId: "raw-multiple-products",
      externalEventId: "event-multiple-products",
      idempotencyKey: "key-multiple-products",
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: {
        Id: "event-multiple-products",
        IsTest: false,
        Event: "Purchase_Order_Confirmed",
        CreatedAt: "2026-07-24T12:00:00Z",
        Data: {
          Products: [
            { Id: "product-1", Name: "Produto 1" },
            { Id: "product-2", Name: "Produto 2" },
          ],
          Buyer: { Email: "Buyer@Example.com" },
          Offer: { Id: "offer-1", Name: "Oferta" },
          Purchase: {
            PaymentId: "payment-1",
            Price: { Value: 100 },
          },
        },
      },
    });

    expect(result.products.map(({ externalId }) => externalId)).toEqual([
      "product-1",
      "product-2",
    ]);
    expect(result.person.identifiers[0]?.normalizedValue).toBe(
      "buyer@example.com",
    );
  });

  it("bloqueia efeito financeiro quando IsTest está ausente", () => {
    const result = normalizeLastlinkEvent({
      rawEventId: "raw-unknown-scope",
      externalEventId: "event-unknown-scope",
      idempotencyKey: "key-unknown-scope",
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: {
        Id: "event-unknown-scope",
        Event: "Purchase_Order_Confirmed",
        CreatedAt: "2026-07-24T12:00:00Z",
        Data: {
          Products: [{ Id: "product-1", Name: "Produto" }],
          Buyer: { Email: "buyer@example.com" },
          Offer: { Id: "offer-1", Name: "Oferta" },
          Purchase: {
            PaymentId: "payment-1",
            Price: { Value: 100 },
          },
        },
      },
    });

    expect(result.scope).toBe("unknown");
    expect(result.warnings).toContain(
      "is_test_missing_financial_effect_blocked",
    );
  });

  it("marca a data incompatível observada no fixture de reembolso", async () => {
    const result = normalizeLastlinkEvent({
      rawEventId: "raw-refund",
      externalEventId: "event-refund",
      idempotencyKey: "key-refund",
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: await fixture("payment_refund.json"),
    });

    expect(result.warnings).toContain(
      "refund_has_chargeback_date_instead_of_refund_date",
    );
  });

  it("quarentena evento sem identidade comercial mínima", () => {
    expect(() =>
      normalizeLastlinkEvent({
        rawEventId: "raw-invalid",
        idempotencyKey: "key-invalid",
        receivedAt: new Date(),
        body: {
          Event: "Purchase_Order_Confirmed",
          Data: {},
        },
      }),
    ).toThrow(LastlinkNormalizationBlocked);
  });

  it("preserves sale value and producer commission separately", async () => {
    const result = normalizeLastlinkEvent({
      rawEventId: "raw-commission",
      externalEventId: "event-commission",
      idempotencyKey: "key-commission",
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: await fixture("purchase_order_confirmed.json"),
    });
    expect(result.paidAmount).toBe(12.5);
    expect(result.producerCommissionAmount).toBe(15.25);
    expect(result.warnings).not.toContain("producer_commission_missing");
    expect(result.ruleVersion).toBe("lastlink-normalization-v2");
  });

  it("does not use sale value as fallback when commission is missing", () => {
    const result = normalizeLastlinkEvent({
      rawEventId: "raw-no-commission",
      externalEventId: "event-no-commission",
      idempotencyKey: "key-no-commission",
      receivedAt: new Date("2026-07-24T12:00:00Z"),
      body: {
        Id: "event-no-commission", IsTest: false,
        Event: "Purchase_Order_Confirmed", CreatedAt: "2026-07-24T12:00:00Z",
        Data: { Products: [{ Id: "product-1", Name: "Produto" }],
          Buyer: { Email: "buyer@example.com" }, Offer: { Id: "offer-1", Name: "Oferta" },
          Purchase: { PaymentId: "payment-1", Price: { Value: 100 } } },
      },
    });
    expect(result.paidAmount).toBe(100);
    expect(result.producerCommissionAmount).toBeUndefined();
    expect(result.warnings).toContain("producer_commission_missing");
  });
});
