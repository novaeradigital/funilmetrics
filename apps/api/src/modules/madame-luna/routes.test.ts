import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { MadameLunaRepository } from "./repository.js";
import { encryptStoredSecret } from "./vault.js";

const publicId = "b44b3fe1-c4c4-4cf4-8bb8-7c3eac2ab6e7";
const secret = "segredo-luna-de-teste";
const vaultKey = Buffer.alloc(32, 5);
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY =
  vaultKey.toString("base64");

function secretRow(value: string, rotatedAt: Date | null) {
  const encrypted = encryptStoredSecret({ webhookSecret: value }, vaultKey);
  return {
    ciphertext: encrypted.ciphertext,
    initializationVector: encrypted.initializationVector,
    authenticationTag: encrypted.authenticationTag,
    rotatedAt,
  };
}

function fakeRepository(secrets = [secretRow(secret, null)]) {
  const persisted: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const repository: MadameLunaRepository = {
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
    findWebhookSecrets: vi.fn(async () => secrets),
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

function sign(body: string, value = secret) {
  return `sha256=${createHmac("sha256", value).update(body).digest("hex")}`;
}

const saleBody = JSON.stringify({
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
    cpf: "12345678900",
    phone: "5511999998888",
  },
  tracking: {
    utm_source: "facebook",
    utm_content: "Criativo|120255009192150198",
  },
});

describe("webhook madame luna", () => {
  it("aceita uma venda aprovada com assinatura valida", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/madame-luna/${publicId}`,
      headers: {
        "content-type": "application/json",
        "x-madame-luna-signature": sign(saleBody),
      },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      source: "madame_luna",
      processingStatus: "queued",
      externalEventName: "payment_approved",
      externalEventId: "madame_luna:app:123:payment_approved",
    });
    await app.close();
  });

  it("rejeita assinatura invalida sem persistir", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/madame-luna/${publicId}`,
      headers: {
        "content-type": "application/json",
        "x-madame-luna-signature": sign(saleBody, "segredo-errado"),
      },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(401);
    expect(persisted).toHaveLength(0);
    await app.close();
  });

  it("rejeita sem assinatura", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/madame-luna/${publicId}`,
      headers: { "content-type": "application/json" },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(401);
    expect(persisted).toHaveLength(0);
    await app.close();
  });

  it("retorna 404 para conexao desconhecida", async () => {
    const { repository } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/madame-luna/99999999-9999-4999-8999-999999999999`,
      headers: {
        "content-type": "application/json",
        "x-madame-luna-signature": sign(saleBody),
      },
      payload: saleBody,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("marca reenvio como duplicado", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const request = {
      method: "POST" as const,
      url: `/webhooks/madame-luna/${publicId}`,
      headers: {
        "content-type": "application/json",
        "x-madame-luna-signature": sign(saleBody),
      },
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

  it("coloca evento fora do contrato em quarentena", async () => {
    const { repository, persisted } = fakeRepository();
    const app = buildApp({ madameLunaRepository: repository });
    const body = saleBody.replace('"payment_approved"', '"payment_pending"');
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/madame-luna/${publicId}`,
      headers: {
        "content-type": "application/json",
        "x-madame-luna-signature": sign(body),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted[0]).toMatchObject({
      processingStatus: "quarantined",
      errorCode: "unknown_event",
    });
    await app.close();
  });
});
