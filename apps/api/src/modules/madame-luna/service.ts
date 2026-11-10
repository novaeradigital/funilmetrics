import type { NewRawEvent } from "@funil-metrics/database";
import {
  isSupportedMadameLunaEventType,
  madameLunaExternalEventId,
  madameLunaPayloadSchema,
  sha256,
} from "./contracts.js";
import type { MadameLunaEndpoint, MadameLunaRepository, RawEventReceipt } from "./repository.js";
import { verifyMadameLunaSignature } from "./signature.js";
import { decryptStoredSecret, loadVaultKey } from "./vault.js";

const parserVersion = "madame-luna-v1";

export type ReceiveMadameLunaInput = {
  connectionPublicId: string;
  body: Buffer;
  signature?: string;
  contentType: string;
  method: string;
  allowedHeaders: Record<string, string | undefined>;
  receivedAt?: Date;
};

export type ReceiveMadameLunaResult =
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "invalid_json"; receiptId: string }
  | { kind: "accepted"; receipt: RawEventReceipt };

async function loadSecrets(
  repository: MadameLunaRepository,
  endpoint: MadameLunaEndpoint,
) {
  const key = loadVaultKey();
  if (!key) return [];
  const rows = await repository.findWebhookSecrets(
    endpoint.projectId,
    endpoint.connectionId,
  );
  const secrets: string[] = [];
  for (const row of rows) {
    try {
      const secret = decryptStoredSecret(row, key);
      const value = String(secret.webhookSecret ?? "").trim();
      if (value) secrets.push(value);
    } catch {
      // Segredo ilegivel nao derruba os demais segredos da conexao.
    }
  }
  return secrets;
}

export function createMadameLunaReceiver(repository: MadameLunaRepository) {
  return async function receiveMadameLuna(
    input: ReceiveMadameLunaInput,
  ): Promise<ReceiveMadameLunaResult> {
    const endpoint = await repository.findActiveEndpoint(
      input.connectionPublicId,
    );
    if (!endpoint) {
      return { kind: "not_found" };
    }

    const receivedAt = input.receivedAt ?? new Date();
    const bodyRaw = input.body.toString("utf8");
    const bodySha256 = sha256(input.body);

    // A assinatura e conferida sobre o corpo cru ANTES do parse: ela e a
    // unica autenticacao da entrega (o segredo nunca viaja na requisicao).
    // Sem assinatura valida, nada e persistido.
    const secrets = await loadSecrets(repository, endpoint);
    if (
      secrets.length === 0 ||
      !verifyMadameLunaSignature(input.body, input.signature, secrets)
    ) {
      return { kind: "unauthorized" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyRaw);
    } catch {
      const receipt = await repository.persistRawEvent({
        organizationId: endpoint.organizationId,
        projectId: endpoint.projectId,
        connectionId: endpoint.connectionId,
        source: "madame_luna",
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

    const payloadResult = madameLunaPayloadSchema.safeParse(parsed);
    if (!payloadResult.success) {
      const receipt = await repository.persistRawEvent({
        organizationId: endpoint.organizationId,
        projectId: endpoint.projectId,
        connectionId: endpoint.connectionId,
        source: "madame_luna",
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
        errorMessage: "Payload fora do formato do webhook da Madame Luna.",
      });
      await repository.touchEndpoint(
        endpoint.endpointId,
        endpoint.connectionId,
        receivedAt,
      );
      return { kind: "accepted", receipt };
    }

    const payload = payloadResult.data;
    const externalEventId = madameLunaExternalEventId(
      payload.system,
      payload.payment.id,
      payload.event,
    );

    let processingStatus: NewRawEvent["processingStatus"] = "queued";
    let validationStatus: NewRawEvent["validationStatus"] = "valid";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (!isSupportedMadameLunaEventType(payload.event)) {
      processingStatus = "quarantined";
      validationStatus = "unknown_event";
      errorCode = "unknown_event";
      errorMessage = "Evento da Madame Luna ainda não mapeado.";
    }

    const receipt = await repository.persistRawEvent({
      organizationId: endpoint.organizationId,
      projectId: endpoint.projectId,
      connectionId: endpoint.connectionId,
      source: "madame_luna",
      externalEventId,
      externalEventName: payload.event,
      method: input.method,
      contentType: input.contentType,
      allowedHeaders: input.allowedHeaders,
      bodyRaw,
      bodyJson: parsed,
      bodySha256,
      idempotencyKey: `external-id:v1:${externalEventId}`,
      idempotencyStrategy: "external_event_id_v1",
      createdAtRaw: payload.occurred_at,
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
