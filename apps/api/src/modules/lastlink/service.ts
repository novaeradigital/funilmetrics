import type { NewRawEvent } from "@funil-metrics/database";
import {
  canonicalJson,
  isKnownEvent,
  lastlinkEnvelopeSchema,
  paymentIdFromData,
  preferredFieldWarnings,
  sha256,
  validateKnownEventData,
} from "./contracts.js";
import type {
  LastlinkEndpoint,
  LastlinkRepository,
  RawEventReceipt,
} from "./repository.js";
import { verifyWebhookToken } from "./token.js";

const parserVersion = "lastlink-v1";
const fallbackVersion = "lastlink-fallback-v1";

export type ReceiveLastlinkInput = {
  connectionPublicId: string;
  token: string | undefined;
  body: Buffer;
  contentType: string;
  method: string;
  allowedHeaders: Record<string, string | undefined>;
  receivedAt?: Date;
};

export type ReceiveLastlinkResult =
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "invalid_json"; receiptId: string }
  | { kind: "accepted"; receipt: RawEventReceipt };

async function tokenMatches(endpoint: LastlinkEndpoint, token: string) {
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

function fallbackKey(
  connectionId: string,
  event: string,
  createdAt: string,
  data: unknown,
) {
  const paymentId = paymentIdFromData(data) ?? "";
  return sha256(
    [
      "lastlink",
      connectionId,
      event,
      createdAt,
      paymentId,
      canonicalJson(data),
      fallbackVersion,
    ].join("\n"),
  );
}

export function createLastlinkReceiver(repository: LastlinkRepository) {
  return async function receiveLastlink(
    input: ReceiveLastlinkInput,
  ): Promise<ReceiveLastlinkResult> {
    const endpoint = await repository.findActiveEndpoint(
      input.connectionPublicId,
    );

    if (!endpoint) {
      return { kind: "not_found" };
    }

    if (!input.token || !(await tokenMatches(endpoint, input.token))) {
      return { kind: "unauthorized" };
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
        source: "lastlink",
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
        errorMessage: "JSON inválido após autenticação.",
      });
      await repository.touchEndpoint(
        endpoint.endpointId,
        endpoint.connectionId,
        receivedAt,
      );
      return { kind: "invalid_json", receiptId: receipt.id };
    }

    const envelopeResult = lastlinkEnvelopeSchema.safeParse(parsed);
    const envelope = envelopeResult.success ? envelopeResult.data : undefined;
    const externalEventId = envelope?.Id?.trim() || undefined;
    const eventName = envelope?.Event;
    const idempotencyKey = externalEventId
      ? `external-id:v1:${externalEventId}`
      : envelope
        ? `fallback:v1:${fallbackKey(
            endpoint.connectionId,
            envelope.Event,
            envelope.CreatedAt,
            envelope.Data,
          )}`
        : `invalid-envelope:${bodySha256}`;

    let processingStatus: NewRawEvent["processingStatus"] = "queued";
    let validationStatus: NewRawEvent["validationStatus"] = "valid";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (!envelopeResult.success) {
      processingStatus = "quarantined";
      validationStatus = "invalid";
      errorCode = "invalid_envelope";
      errorMessage = "Envelope mínimo ausente ou inválido.";
    } else {
      const validEnvelope = envelopeResult.data;

      if (!isKnownEvent(validEnvelope.Event)) {
        processingStatus = "quarantined";
        validationStatus = "unknown_event";
        errorCode = "unknown_event";
        errorMessage = "Evento externo ainda não mapeado.";
      } else {
        const dataResult = validateKnownEventData(validEnvelope.Data);
        if (!dataResult.success) {
          processingStatus = "quarantined";
          validationStatus = "invalid";
          errorCode = "minimum_data_missing";
          errorMessage = "Evento conhecido sem dados mínimos.";
        } else {
          const warnings = preferredFieldWarnings(
            validEnvelope.Event,
            validEnvelope.Data,
          );
          if (warnings.length) {
            validationStatus = "partial";
            errorCode = "preferred_fields_missing";
            errorMessage = warnings.join(",");
          }
        }
      }
    }

    const receipt = await repository.persistRawEvent({
      organizationId: endpoint.organizationId,
      projectId: endpoint.projectId,
      connectionId: endpoint.connectionId,
      source: "lastlink",
      externalEventId,
      externalEventName: eventName,
      isTest: envelope?.IsTest,
      method: input.method,
      contentType: input.contentType,
      allowedHeaders: input.allowedHeaders,
      bodyRaw,
      bodyJson: parsed,
      bodySha256,
      idempotencyKey,
      idempotencyStrategy: externalEventId
        ? "external_event_id_v1"
        : envelope
          ? fallbackVersion
          : "body_sha256_v1",
      createdAtRaw: envelope?.CreatedAt,
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
