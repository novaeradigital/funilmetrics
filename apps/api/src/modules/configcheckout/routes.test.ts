import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { NewRawEvent } from "@funil-metrics/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type {
  ConfigCheckoutEndpoint,
  ConfigCheckoutRepository,
} from "./repository.js";
import { hashWebhookToken } from "./token.js";

const endpointPublicId = "d98a0aed-7126-4d99-b307-fe251eace6b5";
const endpointId = "35c74aed-7126-4d99-b307-fe251eace6b5";
const connectionId = "45c74aed-7126-4d99-b307-fe251eace6b5";
const organizationId = "55c74aed-7126-4d99-b307-fe251eace6b5";
const projectId = "65c74aed-7126-4d99-b307-fe251eace6b5";
const validToken = "configcheckout-test-token";

class MemoryConfigCheckoutRepository implements ConfigCheckoutRepository {
  readonly events: NewRawEvent[] = [];
  endpoint?: ConfigCheckoutEndpoint;

  async findActiveEndpoint(publicId: string) {
    return publicId === endpointPublicId ? this.endpoint : undefined;
  }

  async persistRawEvent(event: NewRawEvent) {
    const existingIndex = this.events.findIndex(
      (candidate) =>
        candidate.connectionId === event.connectionId &&
        (candidate.idempotencyKey === event.idempotencyKey ||
          (event.externalEventId &&
            candidate.externalEventId === event.externalEventId)),
    );

    if (existingIndex >= 0) {
      return {
        id: `receipt-${existingIndex + 1}`,
        duplicate: true,
      };
    }

    this.events.push(event);
    return {
      id: `receipt-${this.events.length}`,
      duplicate: false,
    };
  }

  async touchEndpoint() {}
}

function confirmedBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt-0001",
    type: "payment.confirmed",
    version: 1,
    occurred_at: "2026-10-30T09:12:44-03:00",
    test: true,
    seller: { id: 42 },
    order: {
      token: "order-token-1",
      status: "pago",
      created_at: "2026-10-30T09:10:02-03:00",
      paid_at: "2026-10-30T09:12:44-03:00",
      method: "pix",
      amounts: { total: "197.00" },
      product: { name: "Produto Exemplo" },
      buyer: { email: "anon@example.test" },
    },
    ...overrides,
  });
}

describe("POST /webhooks/configcheckout/:connectionPublicId", () => {
  let repository: MemoryConfigCheckoutRepository;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repository = new MemoryConfigCheckoutRepository();
    repository.endpoint = {
      endpointId,
      connectionId,
      organizationId,
      projectId,
      tokenHash: await hashWebhookToken(validToken),
      previousTokenHash: null,
      previousTokenValidUntil: null,
    };
    app = buildApp({ configCheckoutRepository: repository });
  });

  afterEach(async () => {
    await app.close();
  });

  it("preserva e aceita o fixture payment_confirmed.json", async () => {
    const fixturePath = fileURLToPath(
      new URL(
        `../../../../../docs/payloads/configcheckout/payment_confirmed.json`,
        import.meta.url,
      ),
    );
    const body = await readFile(fixturePath, "utf8");
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": validToken,
      },
      body,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "accepted" });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.bodyRaw).toBe(body);
    expect(repository.events[0]?.source).toBe("configcheckout");
    expect(repository.events[0]?.isTest).toBe(true);
  });

  it("reconhece reentrega sem criar outro bruto", async () => {
    const body = confirmedBody();
    const request = () =>
      app.inject({
        method: "POST",
        url: `/webhooks/configcheckout/${endpointPublicId}`,
        headers: {
          "content-type": "application/json",
          "x-configcheckout-token": validToken,
        },
        body,
      });

    expect((await request()).statusCode).toBe(202);
    const duplicate = await request();
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ status: "duplicate" });
    expect(repository.events).toHaveLength(1);
  });

  it("recusa token inválido sem persistir payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": "invalid-token",
      },
      body: "{}",
    });

    expect(response.statusCode).toBe(401);
    expect(repository.events).toHaveLength(0);
  });

  it("preserva JSON inválido autenticado em quarentena", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": validToken,
      },
      body: '{"type":',
    });

    expect(response.statusCode).toBe(400);
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      processingStatus: "quarantined",
      validationStatus: "invalid",
      errorCode: "invalid_json",
    });
  });

  it("guarda evento desconhecido sem normalizá-lo", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": validToken,
      },
      body: confirmedBody({ type: "order.shipped", id: "evt-unknown" }),
    });

    expect(response.statusCode).toBe(202);
    expect(repository.events[0]).toMatchObject({
      processingStatus: "quarantined",
      validationStatus: "unknown_event",
    });
  });

  it("guarda versão não suportada em quarentena", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": validToken,
      },
      body: confirmedBody({ version: 2, id: "evt-v2" }),
    });

    expect(response.statusCode).toBe(202);
    expect(repository.events[0]).toMatchObject({
      processingStatus: "quarantined",
      validationStatus: "invalid",
      errorCode: "unsupported_version",
    });
  });

  it("não expõe detalhes internos quando o repositório falha", async () => {
    repository.findActiveEndpoint = async () => {
      throw new Error("consulta SQL e parâmetros sensíveis");
    };

    const response = await app.inject({
      method: "POST",
      url: `/webhooks/configcheckout/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-configcheckout-token": validToken,
      },
      body: "{}",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_error" });
    expect(response.body).not.toContain("consulta SQL");
    expect(response.body).not.toContain("parâmetros sensíveis");
  });
});
