import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { KiwifyRepository } from "./repository.js";
import { encryptStoredSecret } from "./vault.js";

const publicId = "a33a2fe0-c4c4-4cf4-8bb8-7c3eac2ab6e7";
const token = "kiwify-token-de-teste";
const vaultKey = Buffer.alloc(32, 3);
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY =
  vaultKey.toString("base64");

function tokenRow(value: string, rotatedAt: Date | null) {
  const encrypted = encryptStoredSecret({ accessToken: value }, vaultKey);
  return {
    ciphertext: encrypted.ciphertext,
    initializationVector: encrypted.initializationVector,
    authenticationTag: encrypted.authenticationTag,
    rotatedAt,
  };
}

function fakeRepository(tokens = [tokenRow(token, null)]) {
  const persisted: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const repository: KiwifyRepository = {
    findActiveEndpoint: vi.fn(async (requested: string) =>
      requested === publicId
        ? {
            endpointId: "11111111-1111-4111-8111-111111111111",
            connectionId: "22222222-2222-4222-8222-222222222222",
            organizationId: "33333333-3333-4333-8333-333333333333",
            projectId: "44444444-4444-4444-8444-444444444444",
          }
        : undefined,
    ),
    findWebhookTokens: vi.fn(async () => tokens),
    persistRawEvent: vi.fn(async (event) => {
      const keys = [
        String(event.idempotencyKey),
        ...(event.externalEventId ? [String(event.externalEventId)] : []),
      ];
      if (keys.some((key) => seen.has(key))) {
        return {
          id: "55555555-5555-4555-8555-555555555555",
          duplicate: true,
        };
      }
      keys.forEach((key) => seen.add(key));
      persisted.push(event as Record<string, unknown>);
      return { id: "55555555-5555-4555-8555-555555555555", duplicate: false };
    }),
    touchEndpoint: vi.fn(async () => {}),
  };
  return { repository, persisted };
}

function sign(body: string, value = token) {
  return createHmac("sha1", value).update(body).digest("hex");
}

const saleBody = JSON.stringify({
  order_id: "7f7e2b76-6339-49af-8788-e753e76b61c1",
  order_ref: "UOcHGBY",
  order_status: "paid",
  webhook_event_type: "order_approved",
  payment_method: "pix",
  installments: 1,
  created_at: "2026-11-04 12:00",
  approved_date: "2026-11-04 12:01",
  Product: {
    product_id: "2a14ad80-7edc-4f06-a237-aa4ae3d0f2c8",
    product_name: "Reapaixonar",
  },
  Customer: {
    full_name: "Maria Silva",
    email: "maria@example.com",
    mobile: "+5511999998888",
    CPF: "48978298784",
    ip: "189.10.20.30",
  },
  Commissions: {
    charge_amount: "4990",
    product_base_price: "4990",
    my_commission: "4491",
  },
  TrackingParameters: {
    src: null,
    sck: "fmt_11111111222233334444555555555555",
    utm_source: "fb",
  },
});

describe("webhook kiwify", () => {
  it("valida o vetor de teste oficial da documentacao", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const body =
      '{"order_id":"9b1c2d3e-0000-4000-8000-000000000001","order_status":"paid","webhook_event_type":"order_approved"}';
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/${publicId}?signature=bf18f352a4f981b91dfa3f6d8742a81080ab8c86`,
      headers: { "content-type": "application/json" },
      payload: body,
    });
    // Assinatura valida: nao e 401. O corpo minimo cai em quarentena de
    // schema, como qualquer payload incompleto.
    expect(response.statusCode).toBe(202);
    expect(persisted[0]).toMatchObject({
      source: "kiwify",
      processingStatus: "quarantined",
      errorCode: "invalid_envelope",
    });
    await app.close();
  });

  it("aceita uma venda aprovada com assinatura valida", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/${publicId}?signature=${sign(saleBody)}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      source: "kiwify",
      processingStatus: "queued",
      externalEventName: "order_approved",
      externalEventId:
        "kiwify:7f7e2b76-6339-49af-8788-e753e76b61c1:order_approved",
    });
    await app.close();
  });

  it("rejeita assinatura invalida sem persistir", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/${publicId}?signature=${sign(saleBody, "token-errado")}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(401);
    expect(persisted).toHaveLength(0);
    await app.close();
  });

  it("retorna 404 para conexao desconhecida", async () => {
    const { repository } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/99999999-9999-4999-8999-999999999999?signature=${sign(saleBody)}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("marca reenvio como duplicado", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const request = {
      method: "POST" as const,
      url: `/webhooks/kiwify/${publicId}?signature=${sign(saleBody)}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toMatchObject({ status: "duplicate" });
    expect(persisted).toHaveLength(1);
    await app.close();
  });

  it("coloca evento de assinatura fora da v1 em quarentena", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ kiwifyRepository: repository });
    const body = saleBody.replace(
      '"order_approved"',
      '"subscription_canceled"',
    );
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/${publicId}?signature=${sign(body)}`,
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted[0]).toMatchObject({
      processingStatus: "quarantined",
      errorCode: "unknown_event",
    });
    await app.close();
  });

  it("aceita o token anterior dentro da janela de troca", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { repository, persisted } = fakeRepository([
      tokenRow("token-novo", null),
      tokenRow(token, yesterday),
    ]);
    const app = buildApp({ kiwifyRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/kiwify/${publicId}?signature=${sign(saleBody)}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted).toHaveLength(1);
    await app.close();
  });
});
