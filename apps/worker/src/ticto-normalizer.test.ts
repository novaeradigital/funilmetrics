import { describe, expect, it } from "vitest";
import {
  normalizeTictoEvent,
  TictoNormalizationBlocked,
} from "./ticto-normalizer.js";

const receivedAt = new Date("2026-11-04T15:05:00.000Z");

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    status: "authorized",
    token: "segredo",
    status_date: "2026-11-04 12:00:00",
    payment_method: "pix",
    checkout_url: "https://pay.ticto.com.br/checkout/abc",
    order: {
      id: 123,
      hash: "orderhash1",
      transaction_hash: "tx-9",
      paid_amount: 1990,
      installments: 1,
    },
    item: {
      product_name: "Reapaixonar Marido",
      product_id: 55,
      offer_name: "Oferta principal",
      offer_code: "OF1",
      amount: 2990,
    },
    customer: {
      name: "Maria Silva",
      email: "MARIA@example.com",
      cpf: "123.456.789-00",
      phone: { ddi: "55", ddd: "11", number: "999887766" },
      address: { city: "São Paulo", state: "SP", zip_code: "01001-000" },
    },
    tracking: {
      utm_source: "facebook",
      utm_medium: "cpc",
      utm_campaign: "campanha-x",
      utm_content: "120254928435570198",
      sck: "fmt_11111111222233334444555555555555",
    },
    ...overrides,
  };
}

function normalize(body: unknown) {
  return normalizeTictoEvent({
    rawEventId: "raw-1",
    externalEventId: "ticto:orderhash1:authorized",
    idempotencyKey: "external-id:v1:ticto:orderhash1:authorized",
    receivedAt,
    body,
  });
}

describe("normalizeTictoEvent", () => {
  it("mapeia uma venda autorizada com valores em reais e atribuicao", () => {
    const normalized = normalize(basePayload());
    expect(normalized.normalizedType).toBe("payment_approved");
    expect(normalized.orderStatus).toBe("approved");
    expect(normalized.financialIntent).toBe("approve");
    expect(normalized.scope).toBe("production");
    expect(normalized.paidAmount).toBe(19.9);
    expect(normalized.originalAmount).toBe(29.9);
    expect(normalized.orderExternalKey).toBe("orderhash1");
    expect(normalized.payment?.externalPaymentId).toBe("tx-9");
    expect(normalized.payment?.method).toBe("pix");
    expect(normalized.products).toEqual([
      { externalId: "55", name: "Reapaixonar Marido" },
    ]);
    expect(normalized.offer.externalId).toBe("OF1");
    expect(normalized.attribution.sck).toBe(
      "fmt_11111111222233334444555555555555",
    );
    expect(normalized.attribution.utmContent).toBe("120254928435570198");
    expect(normalized.person.identifiers[0]).toMatchObject({
      type: "email",
      normalizedValue: "maria@example.com",
    });
    expect(
      normalized.person.identifiers.find((i) => i.type === "phone")
        ?.normalizedValue,
    ).toBe("+5511999887766");
    expect(normalized.buyerAddress.city).toBe("São Paulo");
    expect(normalized.occurredAt.toISOString()).toBe(
      "2026-11-04T15:00:00.000Z",
    );
  });

  it("mapeia carrinho abandonado sem efeito financeiro e sem pagamento", () => {
    const normalized = normalize(basePayload({ status: "abandoned_cart" }));
    expect(normalized.normalizedType).toBe("checkout_abandoned");
    expect(normalized.orderStatus).toBe("abandoned");
    expect(normalized.financialIntent).toBe("none");
    expect(normalized.payment).toBeUndefined();
  });

  it("mapeia reembolso com efeito de estorno", () => {
    const normalized = normalize(basePayload({ status: "refunded" }));
    expect(normalized.normalizedType).toBe("payment_refunded");
    expect(normalized.financialIntent).toBe("reverse");
  });

  it("bloqueia sem e-mail do comprador", () => {
    expect(() =>
      normalize(basePayload({ customer: { name: "Sem Email" } })),
    ).toThrow(TictoNormalizationBlocked);
  });

  it("bloqueia status desconhecido", () => {
    expect(() => normalize(basePayload({ status: "subscription_renewed" })))
      .toThrow(TictoNormalizationBlocked);
  });
});
