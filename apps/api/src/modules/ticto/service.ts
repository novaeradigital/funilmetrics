import type { NewRawEvent } from "@funil-metrics/database";
import {
  canonicalJson,
  isKnownTictoStatus,
  sha256,
  tictoExternalEventId,
  tictoPayloadSchema,
} from "./contracts.js";
import type {
  RawEventReceipt,
  TictoEndpoint,
  TictoRepository,
} from "./repository.js";
import { verifyWebhookToken } from "./token.js";

const parserVersion = "ticto-v1";
const fallbackVersion = "ticto-fallback-v1";

export type ReceiveTictoInput = {
  connectionPublicId: string;
  body: Buffer;
  contentType: string;
  method: string;
  allowedHeaders: Record<string, string | undefined>;
  receivedAt?: Date;
};

export type ReceiveTictoResult =
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "invalid_json"; receiptId: string }
  | { kind: "accepted"; receipt: RawEventReceipt };

async function tokenMatches(endpoint: TictoEndpoint, token: string) {
  if (await verifyWebhookToken(token, endpoint.tokenHash)) {
    return true;
  }
  return Boolean(
    endpoint.previousTokenHash &&
      endpoint.previousTokenValidUntil &&
      endpoint.previousTokenValidUntil > new Date() &&
      (await verifyWebhookToken(token, endpoint.previousTokenHash)),
  );
}

export function createTictoReceiver(repository: TictoRepository) {
  return async function receiveTicto(
    input: ReceiveTictoInput,
  ): Promise<ReceiveTictoResult> {
    const endpoint = await repository.findActiveEndpoint(
      input.connectionPublicId,
    );
    if (!endpoint) {
      return { kind: "not_found" };
    }

    const receivedAt = input.receivedAt ?? new Date();
    const bodyRaw = input.body.toString("utf8");
    const bodySha256 = sha256(input.body);
    let parsed: unknown;

    try {
      parsed = JSON.parse(bodyRaw);
    } catch {
      const receipt = await repository.persistRawEvent({
        organizationId: endpoint.organizationId,
        projectId: endpoint.projectId,
        connectionId: endpoint.connectionId,
        source: "ticto",
        method: input.method,
        contentType: input.contentType,
        allowedHeaders: input.allowedHeaders,
        bodyRaw,
        bodySha256,
        idempotencyKey: `invalid-json:${bodySha256}`,
        idempotencyStrategy: "body_sha256_v1",
        receivedAt,
        processingStatus: "quarantined",
        validationStatus: "invalid",
        parserVersion,
        errorCode: "invalid_json",
        errorMessage: "JSON inválido.",
      });
      await repository.touchEndpoint(
        endpoint.endpointId,
        endpoint.connectionId,
        receivedAt,
      );
      return { kind: "invalid_json", receiptId: receipt.id };
    }

    const payloadResult = tictoPayloadSchema.safeParse(parsed);
    if (!payloadResult.success) {
      const receipt = await repository.persistRawEvent({
        organizationId: endpoint.organizationId,
        projectId: endpoint.projectId,
        connectionId: endpoint.connectionId,
        source: "ticto",
        method: input.method,
        contentType: input.contentType,
        allowedHeaders: input.allowedHeaders,
        bodyRaw,
        bodyJson: parsed,
        bodySha256,
        idempotencyKey: `invalid-envelope:${bodySha256}`,
        idempotencyStrategy: "body_sha256_v1",
        receivedAt,
        processingStatus: "quarantined",
        validationStatus: "invalid",
        parserVersion,
        errorCode: "invalid_envelope",
        errorMessage: "Payload sem status ou token.",
      });
      await repository.touchEndpoint(
        endpoint.endpointId,
        endpoint.connectionId,
        receivedAt,
      );
      return { kind: "accepted", receipt };
    }

    const payload = payloadResult.data;
    if (!(await tokenMatches(endpoint, payload.token))) {
      return { kind: "unauthorized" };
    }

    const externalEventId = tictoExternalEventId(payload);
    const idempotencyKey = externalEventId
      ? `external-id:v1:${externalEventId}`
      : `fallback:v1:${sha256(
          [
            "ticto",
            endpoint.connectionId,
            payload.status,
            payload.status_date ?? "",
            canonicalJson(parsed),
            fallbackVersion,
          ].join("\n"),
        )}`;

    let processingStatus: NewRawEvent["processingStatus"] = "queued";
    let validationStatus: NewRawEvent["validationStatus"] = "valid";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (!isKnownTictoStatus(payload.status)) {
      processingStatus = "quarantined";
      validationStatus = "unknown_event";
      errorCode = "unknown_event";
      errorMessage = "Status da Ticto ainda não mapeado.";
    } else if (!payload.order?.hash && payload.status === "authorized") {
      validationStatus = "partial";
      errorCode = "preferred_fields_missing";
      errorMessage = "Venda autorizada sem order.hash.";
    }

    const receipt = await repository.persistRawEvent({
      organizationId: endpoint.organizationId,
      projectId: endpoint.projectId,
      connectionId: endpoint.connectionId,
      source: "ticto",
      externalEventId,
      externalEventName: payload.status,
      method: input.method,
      contentType: input.contentType,
      allowedHeaders: input.allowedHeaders,
      bodyRaw,
      bodyJson: parsed,
      bodySha256,
      idempotencyKey,
      idempotencyStrategy: externalEventId
        ? "external_event_id_v1"
        : fallbackVersion,
      createdAtRaw: payload.status_date,
      receivedAt,
      processingStatus,
      validationStatus,
      parserVersion,
      errorCode,
      errorMessage,
    });

    await repository.touchEndpoint(
      endpoint.endpointId,
      endpoint.connectionId,
      receivedAt,
    );

    return { kind: "accepted", receipt };
  };
}
