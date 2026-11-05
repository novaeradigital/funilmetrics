import { describe, expect, it } from "vitest";
import {
  KiwifyNormalizationBlocked,
  normalizeKiwifyEvent,
} from "./kiwify-normalizer.js";

const receivedAt = new Date("2026-11-04T15:05:00.000Z");

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "7f7e2b76-6339-49af-8788-e753e76b61c1",
    order_ref: "UOcHGBY",
    order_status: "paid",
    webhook_event_type: "order_approved",
    payment_method: "pix",
    installments: 1,
    created_at: "2026-11-04 12:00",
    updated_at: "2026-11-04 12:01",
    approved_date: "2026-11-04 12:01",
    refunded_at: null,
    Product: {
      product_id: "2a14ad80-7edc-4f06-a237-aa4ae3d0f2c8",
      product_name: "Reapaixonar Marido",
    },
    Customer: {
      full_name: "Maria Silva",
      email: "MARIA@example.com",
      mobile: "+55 11 99999-8888",
      CPF: "489.782.987-84",
      ip: "189.10.20.30",
    },
    Commissions: {
      charge_amount: "4990",
      product_base_price: "5990",
      my_commission: "4491",
    },
    TrackingParameters: {
      src: null,
      sck: "fmt_11111111222233334444555555555555",
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "campanha-x",
      utm_content: "120254928435570198",
      utm_term: null,
    },
    ...overrides,
  };
}

function normalize(body: unknown) {
  return normalizeKiwifyEvent({
    rawEventId: "raw-1",
    externalEventId:
      "kiwify:7f7e2b76-6339-49af-8788-e753e76b61c1:order_approved",
    idempotencyKey: "external-id:v1:kiwify:order",
    receivedAt,
    body,
  });
}

describe("normalizeKiwifyEvent", () => {
  it("mapeia uma venda aprovada com valores em reais e atribuicao", () => {
    const event = normalize(basePayload());
    expect(event.normalizedType).toBe("payment_approved");
    expect(event.financialIntent).toBe("approve");
    expect(event.orderExternalKey).toBe(
      "7f7e2b76-6339-49af-8788-e753e76b61c1",
    );
    expect(event.paidAmount).toBe(49.9);
    expect(event.originalAmount).toBe(59.9);
    expect(event.producerCommissionAmount).toBe(44.91);
    expect(event.attribution.sck).toBe(
      "fmt_11111111222233334444555555555555",
    );
    expect(event.attribution.utmSource).toBe("facebook");
    expect(event.person.displayName).toBe("Maria Silva");
    expect(event.person.identifiers).toContainEqual({
      type: "email",
      normalizedValue: "maria@example.com",
      rawValue: "MARIA@example.com",
    });
    expect(event.person.identifiers).toContainEqual({
      type: "document",
      normalizedValue: "48978298784",
      rawValue: "489.782.987-84",
    });
    expect(event.occurredAt.toISOString()).toBe("2026-11-04T15:01:00.000Z");
    expect(event.warnings).toEqual([]);
  });

  it("mapeia reembolso como reversao", () => {
    const event = normalize(
      basePayload({
        webhook_event_type: "order_refunded",
        order_status: "refunded",
        refunded_at: "2026-11-05 09:30",
      }),
    );
    expect(event.normalizedType).toBe("payment_refunded");
    expect(event.financialIntent).toBe("reverse");
    expect(event.occurredAt.toISOString()).toBe("2026-11-05T12:30:00.000Z");
  });

  it("mapeia pix gerado como pendente sem efeito financeiro", () => {
    const event = normalize(
      basePayload({
        webhook_event_type: "pix_created",
        order_status: "waiting_payment",
        payment_method: "pix",
        approved_date: null,
      }),
    );
    expect(event.normalizedType).toBe("payment_pending");
    expect(event.financialIntent).toBe("none");
  });

  it("mapeia renovacao de assinatura paga como aprovacao", () => {
    const event = normalize(
      basePayload({ webhook_event_type: "subscription_renewed" }),
    );
    expect(event.normalizedType).toBe("payment_approved");
    expect(event.financialIntent).toBe("approve");
  });

  it("bloqueia evento nao suportado", () => {
    expect(() =>
      normalize(basePayload({ webhook_event_type: "order_unknown" })),
    ).toThrow(KiwifyNormalizationBlocked);
  });
});
