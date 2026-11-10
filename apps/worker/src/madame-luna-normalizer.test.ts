import { describe, expect, it } from "vitest";
import {
  MadameLunaNormalizationBlocked,
  normalizeMadameLunaEvent,
} from "./madame-luna-normalizer.js";

const receivedAt = new Date("2026-11-10T05:00:00.000Z");

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    event: "payment_approved",
    occurred_at: "2026-11-10T01:59:00-03:00",
    system: "app",
    payment: {
      id: "123",
      gateway_id: "987",
      product_id: "consulta",
      product_name: "Consulta Madame Luna",
      amount: 19.9,
      net_amount: null,
      currency: "BRL",
      method: "pix",
      installments: 1,
    },
    customer: {
      name: "Maria Silva",
      email: null,
      cpf: "123.456.789-00",
      phone: "5511999998888",
    },
    tracking: {
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "campanha",
      utm_content: "Criativo|120255009192150198",
      utm_term: null,
      fbclid: "IwAR123",
      fbp: null,
      fbc: null,
      sck: null,
    },
    ...overrides,
  };
}

function normalize(body: unknown) {
  return normalizeMadameLunaEvent({
    rawEventId: "raw-1",
    externalEventId: "madame_luna:app:123:payment_approved",
    idempotencyKey: "external-id:v1:madame_luna:app:123:payment_approved",
    receivedAt,
    body,
  });
}

describe("normalizeMadameLunaEvent", () => {
  it("aprova venda so com CPF (consulta nao pede e-mail)", () => {
    const result = normalize(baseBody());
    expect(result.normalizedType).toBe("payment_approved");
    expect(result.financialIntent).toBe("approve");
    expect(result.orderExternalKey).toBe("app:123");
    expect(result.paidAmount).toBe(19.9);
    expect(result.producerCommissionAmount).toBeUndefined();
    expect(result.warnings).toContain("producer_commission_missing");
    expect(result.person.identifiers.map((i) => i.type)).toEqual([
      "document",
      "phone",
    ]);
    expect(result.attribution.utmContent).toBe(
      "Criativo|120255009192150198",
    );
    expect(result.occurredAtBasis).toBe("provider_date");
  });

  it("separa as chaves por sistema (app e tr nao colidem)", () => {
    const result = normalize(baseBody({ system: "tr" }));
    expect(result.orderExternalKey).toBe("tr:123");
    expect(result.payment?.externalPaymentId).toBe("tr:123");
  });

  it("usa o liquido quando o payload traz", () => {
    const body = baseBody();
    (body.payment as Record<string, unknown>).net_amount = 16.5;
    const result = normalize(body);
    expect(result.producerCommissionAmount).toBe(16.5);
    expect(result.warnings).not.toContain("producer_commission_missing");
  });

  it("reembolso e chargeback revertem", () => {
    const refund = normalize(baseBody({ event: "payment_refunded" }));
    expect(refund.financialIntent).toBe("reverse");
    expect(refund.orderStatus).toBe("refunded");
    const chargeback = normalize(baseBody({ event: "payment_chargeback" }));
    expect(chargeback.financialIntent).toBe("reverse");
    expect(chargeback.orderStatus).toBe("chargeback");
  });

  it("bloqueia sem e-mail e sem CPF", () => {
    const body = baseBody();
    (body.customer as Record<string, unknown>).cpf = null;
    expect(() => normalize(body)).toThrow(MadameLunaNormalizationBlocked);
  });

  it("bloqueia evento desconhecido", () => {
    expect(() => normalize(baseBody({ event: "payment_pending" }))).toThrow(
      MadameLunaNormalizationBlocked,
    );
  });
});
