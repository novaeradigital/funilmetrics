import type { NewRawEvent } from "@funil-metrics/database";
import {
  isSupportedKiwifyEventType,
  kiwifyExternalEventId,
  kiwifyPayloadSchema,
  sha256,
} from "./contracts.js";
import type { KiwifyEndpoint, KiwifyRepository, RawEventReceipt } from "./repository.js";
import { verifyKiwifySignature } from "./signature.js";
import { decryptStoredSecret, loadVaultKey } from "./vault.js";

const parserVersion = "kiwify-v1";

export type ReceiveKiwifyInput = {
  connectionPublicId: string;
  body: Buffer;
  signature?: string;
  contentType: string;
  method: string;
  allowedHeaders: Record<string, string | undefined>;
  receivedAt?: Date;
};

export type ReceiveKiwifyResult =
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "invalid_json"; receiptId: string }
  | { kind: "accepted"; receipt: RawEventReceipt };

async function loadTokens(
  repository: KiwifyRepository,
  endpoint: KiwifyEndpoint,
) {
  const key = loadVaultKey();
  if (!key) return [];
  const rows = await repository.findWebhookTokens(
    endpoint.projectId,
    endpoint.connectionId,
  );
  const tokens: string[] = [];
  for (const row of rows) {
    try {
      const secret = decryptStoredSecret(row, key);
      const token = String(secret.accessToken ?? "").trim();
      if (token) tokens.push(token);
    } catch {
      // Segredo ilegivel nao derruba os demais tokens da conexao.
    }
  }
  return tokens;
}

export function createKiwifyReceiver(repository: KiwifyRepository) {
  return async function receiveKiwify(
    input: ReceiveKiwifyInput,
  ): Promise<ReceiveKiwifyResult> {
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
    // unica autenticacao da entrega (o token nunca viaja na requisicao).
    // Sem assinatura valida, nada e persistido.
    const tokens = await loadTokens(repository, endpoint);
    if (
      tokens.length === 0 ||
      !verifyKiwifySignature(input.body, input.signature, tokens)
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
        source: "kiwify",
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

    const payloadResult = kiwifyPayloadSchema.safeParse(parsed);
    if (!payloadResult.success) {
      const receipt = await repository.persistRawEvent({
        organizationId: endpoint.organizationId,
        projectId: endpoint.projectId,
        connectionId: endpoint.connectionId,
        source: "kiwify",
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
        errorMessage: "Payload fora do formato de pedido da Kiwify.",
      });
      await repository.touchEndpoint(
        endpoint.endpointId,
        endpoint.connectionId,
        receivedAt,
      );
      return { kind: "accepted", receipt };
    }

    const payload = payloadResult.data;
    const externalEventId = kiwifyExternalEventId(
      payload.order_id,
      payload.webhook_event_type,
    );

    let processingStatus: NewRawEvent["processingStatus"] = "queued";
    let validationStatus: NewRawEvent["validationStatus"] = "valid";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;

    if (!isSupportedKiwifyEventType(payload.webhook_event_type)) {
      processingStatus = "quarantined";
      validationStatus = "unknown_event";
      errorCode = "unknown_event";
      errorMessage = "Evento da Kiwify ainda não mapeado.";
    }

    const receipt = await repository.persistRawEvent({
      organizationId: endpoint.organizationId,
      projectId: endpoint.projectId,
      connectionId: endpoint.connectionId,
      source: "kiwify",
      externalEventId,
      externalEventName: payload.webhook_event_type,
      method: input.method,
      contentType: input.contentType,
      allowedHeaders: input.allowedHeaders,
      bodyRaw,
      bodyJson: parsed,
      bodySha256,
      idempotencyKey: `external-id:v1:${externalEventId}`,
      idempotencyStrategy: "external_event_id_v1",
      createdAtRaw: payload.created_at,
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
