import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { hashWebhookToken } from "./token.js";
import type { TictoRepository } from "./repository.js";

const publicId = "a33a2fe0-c4c4-4cf4-8bb8-7c3eac2ab6e7";
const token = "token-gerado-pela-ticto";

async function fakeRepository() {
  const persisted: Array<Record<string, unknown>> = [];
  const repository: TictoRepository = {
    findActiveEndpoint: vi.fn(async () => ({
      endpointId: "11111111-1111-4111-8111-111111111111",
      connectionId: "22222222-2222-4222-8222-222222222222",
      organizationId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      tokenHash: await hashWebhookToken(token),
      previousTokenHash: null,
      previousTokenValidUntil: null,
    })),
    persistRawEvent: vi.fn(async (event) => {
      persisted.push(event as Record<string, unknown>);
      return { id: "55555555-5555-4555-8555-555555555555", duplicate: false };
    }),
    touchEndpoint: vi.fn(async () => {}),
  };
  return { repository, persisted };
}

const salePayload = {
  version: "2.0",
  status: "authorized",
  token,
  status_date: "2026-11-04 12:00:00",
  payment_method: "pix",
  order: {
    id: 123,
    hash: "abc123hash",
    transaction_hash: "tx-1",
    paid_amount: 1990,
  },
  item: { product_name: "Reapaixonar", product_id: 55, offer_code: "OF1" },
  customer: { name: "Maria", email: "maria@example.com" },
  tracking: { sck: "fmt_11111111222233334444555555555555", utm_source: "fb" },
};

describe("webhook ticto", () => {
  it("aceita uma venda autorizada com token valido", async () => {
    const { repository, persisted } = await fakeRepository();
    const app = buildApp({ tictoRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/ticto/${publicId}`,
      payload: salePayload,
    });
    expect(response.statusCode).toBe(202);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      source: "ticto",
      externalEventName: "authorized",
      externalEventId: "ticto:abc123hash:authorized",
      processingStatus: "queued",
    });
    await app.close();
  });

  it("rejeita token invalido sem persistir", async () => {
    const { repository, persisted } = await fakeRepository();
    const app = buildApp({ tictoRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/ticto/${publicId}`,
      payload: { ...salePayload, token: "outro-token" },
    });
    expect(response.statusCode).toBe(401);
    expect(persisted).toHaveLength(0);
    await app.close();
  });

  it("coloca em quarentena um status desconhecido", async () => {
    const { repository, persisted } = await fakeRepository();
    const app = buildApp({ tictoRepository: repository });
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/ticto/${publicId}`,
      payload: { ...salePayload, status: "subscription_renewed" },
    });
    expect(response.statusCode).toBe(202);
    expect(persisted[0]).toMatchObject({
      processingStatus: "quarantined",
      validationStatus: "unknown_event",
    });
    await app.close();
  });
});
