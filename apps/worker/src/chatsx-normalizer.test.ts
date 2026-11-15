import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ChatsxNormalizationBlocked,
  normalizeChatsxEvent,
} from "./chatsx-normalizer.js";

async function fixture(name: string) {
  const url = new URL(
    `../../../docs/payloads/chatsx/${name}`,
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
    order: {
      token: "assinatura:42",
      status: "pago",
      created_at: "2026-10-30T09:10:02-03:00",
      paid_at: "2026-10-30T09:12:44-03:00",
      method: "pix",
      installments: 1,
      amounts: { subtotal: "29.90", total: "29.90" },
      gateway: { name: "appmax", payment_id: "ord_123" },
      checkout: { id: "chatsx", name: "ChatSX VIP" },
      plan: { key: "unico_30", label: "30 dias", kind: "unico" },
      product: { id: "unico_30", name: "30 dias" },
      buyer: {
        name: "Compradora Exemplo",
        email: "anon@example.test",
        phone: "+5511999999999",
        document: "123.456.789-09",
      },
      attribution: {
        domain: "sx.rotasdigital.com.br",
        utm: {
          utm_source: "facebook",
          utm_medium: "cpc",
          utm_campaign: "lancamento",
          utm_content: "120254537292430667",
          utm_term: "",
        },
      },
    },
    ...overrides,
  };
}

function normalize(body: unknown, rawEventId = "raw-1") {
  return normalizeChatsxEvent({
    rawEventId,
    externalEventId: "evt-1",
    idempotencyKey: "key-1",
    receivedAt: new Date("2026-10-30T12:15:00Z"),
    body,
  });
}

describe("normalizeChatsxEvent", () => {
  it("normaliza o fixture de pagamento confirmado como payment_approved", async () => {
    const result = normalizeChatsxEvent({
      rawEventId: "raw-1",
      externalEventId: "evt-1",
      idempotencyKey: "key-1",
      receivedAt: new Date("2026-10-30T12:15:00Z"),
      body: await fixture("payment_confirmed.json"),
    });

    expect(result.normalizedType).toBe("payment_approved");
    expect(result.scope).toBe("test");
    expect(result.orderExternalKey).toBe("assinatura:42");
    expect(result.paidAmount).toBe(29.9);
    expect(result.originalAmount).toBe(29.9);
    expect(result.occurredAtBasis).toBe("payment_date");
    expect(result.offer.externalId).toBe("checkout:chatsx");
    expect(result.products).toEqual([
      { externalId: "unico_30", name: "30 dias" },
    ]);
    expect(result.attribution.utmContent).toBe("120254537292430667");
    expect(result.attribution.originUrl).toBe(
      "https://sx.rotasdigital.com.br",
    );
    expect(result.person.identifiers.map((item) => item.type)).toEqual([
      "email",
      "phone",
      "document",
    ]);
  });

  it("pedido criado vira payment_pending sem efeito financeiro", () => {
    const result = normalize(envelope({ type: "order.created" }), "raw-2");

    expect(result.normalizedType).toBe("payment_pending");
    expect(result.financialIntent).toBe("none");
    expect(result.scope).toBe("production");
    expect(result.occurredAtBasis).toBe("created_at");
  });

  it("estorno vira payment_refunded com intenção de reversão", () => {
    const result = normalize(envelope({ type: "order.refunded" }), "raw-3");

    expect(result.normalizedType).toBe("payment_refunded");
    expect(result.financialIntent).toBe("reverse");
    expect(result.warnings).toContain("producer_commission_missing");
  });

  it("chargeback vira payment_chargeback com intenção de reversão", () => {
    const result = normalize(envelope({ type: "order.chargeback" }), "raw-4");

    expect(result.normalizedType).toBe("payment_chargeback");
    expect(result.financialIntent).toBe("reverse");
  });

  it("sem a marca de teste o escopo fica desconhecido e o efeito é bloqueado", () => {
    const body = envelope();
    delete (body as Record<string, unknown>).test;
    const result = normalize(body, "raw-5");

    expect(result.scope).toBe("unknown");
    expect(result.warnings).toContain(
      "is_test_missing_financial_effect_blocked",
    );
  });

  it("bloqueia evento desconhecido", () => {
    expect(() =>
      normalize(envelope({ type: "order.shipped" }), "raw-6"),
    ).toThrow(ChatsxNormalizationBlocked);
  });

  it("bloqueia evento de recorrência fora do escopo", () => {
    const body = envelope();
    (body.order as Record<string, unknown>).plan = {
      key: "assinatura_premium",
      label: "Assinatura Premium",
      kind: "recorrente",
    };
    let thrown: unknown;
    try {
      normalize(body, "raw-7");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChatsxNormalizationBlocked);
    expect((thrown as ChatsxNormalizationBlocked).code).toBe(
      "recurring_out_of_scope",
    );
  });

  it("bloqueia pedido sem e-mail do comprador", () => {
    const body = envelope();
    (body.order as Record<string, unknown>).buyer = { name: "Sem e-mail" };
    expect(() => normalize(body, "raw-8")).toThrow(
      ChatsxNormalizationBlocked,
    );
  });
});

describe("tipos normalizados dentro do enum do banco", () => {
  const tiposPermitidos = [
    "checkout_abandoned",
    "payment_pending",
    "payment_approved",
    "payment_request_expired",
    "payment_request_cancelled",
    "refund_requested",
    "payment_refunded",
    "payment_chargeback",
  ];

  it.each([
    ["order.created", "payment_pending"],
    ["payment.confirmed", "payment_approved"],
    ["order.refunded", "payment_refunded"],
    ["order.chargeback", "payment_chargeback"],
  ])("%s normaliza para %s", (tipoFonte, tipoEsperado) => {
    const result = normalize(envelope({ type: tipoFonte }), "raw-tipos");

    expect(tiposPermitidos).toContain(result.normalizedType);
    expect(result.normalizedType).toBe(tipoEsperado);
  });
});
