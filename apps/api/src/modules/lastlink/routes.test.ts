import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { NewRawEvent } from "@funil-metrics/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type {
  LastlinkEndpoint,
  LastlinkRepository,
} from "./repository.js";
import { hashWebhookToken } from "./token.js";

const endpointPublicId = "d98a0aed-7126-4d99-b307-fe251eace6b5";
const endpointId = "35c74aed-7126-4d99-b307-fe251eace6b5";
const connectionId = "45c74aed-7126-4d99-b307-fe251eace6b5";
const organizationId = "55c74aed-7126-4d99-b307-fe251eace6b5";
const projectId = "65c74aed-7126-4d99-b307-fe251eace6b5";
const validToken = "lastlink-test-token";

const fixtureNames = [
  "abandoned_cart.json",
  "purchase_request_confirmed.json",
  "purchase_order_confirmed.json",
  "purchase_request_expired.json",
  "purchase_request_canceled.json",
  "refund_requested.json",
  "payment_refund.json",
  "payment_chargeback.json",
];

class MemoryLastlinkRepository implements LastlinkRepository {
  readonly events: NewRawEvent[] = [];
  endpoint?: LastlinkEndpoint;

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

describe("POST /webhooks/lastlink/:connectionPublicId", () => {
  let repository: MemoryLastlinkRepository;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    repository = new MemoryLastlinkRepository();
    repository.endpoint = {
      endpointId,
      connectionId,
      organizationId,
      projectId,
      tokenHash: await hashWebhookToken(validToken),
      previousTokenHash: null,
      previousTokenValidUntil: null,
    };
    app = buildApp({ lastlinkRepository: repository });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(fixtureNames)("preserva e aceita o fixture %s", async (fixtureName) => {
    const fixturePath = fileURLToPath(
      new URL(
        `../../../../../docs/payloads/lastlink/${fixtureName}`,
        import.meta.url,
      ),
    );
    const body = await readFile(fixturePath, "utf8");
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/lastlink/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-lastlink-token": validToken,
      },
      body,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "accepted" });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]?.bodyRaw).toBe(body);
    expect(repository.events[0]?.isTest).toBe(true);
  });

  it("reconhece reentrega sem criar outro bruto", async () => {
    const body = JSON.stringify({
      Id: "531eb733-da95-45c7-8040-a21ae32d27a6",
      IsTest: true,
      Event: "Abandoned_Cart",
      CreatedAt: "2026-07-24T00:24:00",
      Data: {
        Products: [{ Id: "product", Name: "Produto" }],
        Buyer: { Email: "anon@example.test" },
        Offer: { Id: "offer", Name: "Oferta" },
      },
    });
    const request = () =>
      app.inject({
        method: "POST",
        url: `/webhooks/lastlink/${endpointPublicId}`,
        headers: {
          "content-type": "application/json",
          "x-lastlink-token": validToken,
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
      url: `/webhooks/lastlink/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-lastlink-token": "invalid-token",
      },
      body: "{}",
    });

    expect(response.statusCode).toBe(401);
    expect(repository.events).toHaveLength(0);
  });

  it("preserva JSON inválido autenticado em quarentena", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/webhooks/lastlink/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-lastlink-token": validToken,
      },
      body: '{"Event":',
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
      url: `/webhooks/lastlink/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-lastlink-token": validToken,
      },
      body: JSON.stringify({
        Id: "unknown-event-id",
        IsTest: true,
        Event: "Future_Event",
        CreatedAt: "2026-07-24T00:24:00",
        Data: {},
      }),
    });

    expect(response.statusCode).toBe(202);
    expect(repository.events[0]).toMatchObject({
      processingStatus: "quarantined",
      validationStatus: "unknown_event",
    });
  });

  it("não expõe detalhes internos quando o repositório falha", async () => {
    repository.findActiveEndpoint = async () => {
      throw new Error("consulta SQL e parâmetros sensíveis");
    };

    const response = await app.inject({
      method: "POST",
      url: `/webhooks/lastlink/${endpointPublicId}`,
      headers: {
        "content-type": "application/json",
        "x-lastlink-token": validToken,
      },
      body: "{}",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_error" });
    expect(response.body).not.toContain("consulta SQL");
    expect(response.body).not.toContain("parâmetros sensíveis");
  });
});
