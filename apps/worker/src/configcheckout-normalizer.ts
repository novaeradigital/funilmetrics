export const configCheckoutRuleVersion = "configcheckout-normalization-v2";

const eventMapping = {
  "order.created": {
    type: "payment_pending",
    orderStatus: "pending",
    paymentStatus: "pending",
    effect: "none",
  },
  "payment.confirmed": {
    type: "payment_approved",
    orderStatus: "approved",
    paymentStatus: "approved",
    effect: "approve",
  },
  "payment.analysis": {
    type: "payment_pending",
    orderStatus: "in_analysis",
    paymentStatus: "in_analysis",
    effect: "none",
  },
  "payment.failed": {
    type: "payment_pending",
    orderStatus: "failed",
    paymentStatus: "failed",
    effect: "none",
  },
  "order.canceled": {
    type: "payment_request_cancelled",
    orderStatus: "cancelled",
    paymentStatus: "cancelled",
    effect: "none",
  },
  "order.refunded": {
    type: "payment_refunded",
    orderStatus: "refunded",
    paymentStatus: "refunded",
    effect: "reverse",
  },
  "order.chargeback": {
    type: "payment_chargeback",
    orderStatus: "chargeback",
    paymentStatus: "chargeback",
    effect: "reverse",
  },
} as const;

type JsonObject = Record<string, unknown>;

export class ConfigCheckoutNormalizationBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigCheckoutNormalizationBlocked";
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function money(value: unknown): number | undefined {
  const candidate = text(value);
  if (!candidate || !/^-?\d+(\.\d{1,2})?$/.test(candidate)) {
    return undefined;
  }
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizedEmail(value: unknown): string | undefined {
  const candidate = text(value)?.trim().toLowerCase();
  return candidate || undefined;
}

function normalizedPhone(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/[^\d+]/g, "");
  return candidate || undefined;
}

function normalizedDocument(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/\D/g, "");
  return candidate || undefined;
}

function parseTimestampWithTimezone(value: unknown) {
  const raw = text(value);
  if (!raw || !/(?:z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export type NormalizedConfigCheckoutEvent = ReturnType<
  typeof normalizeConfigCheckoutEvent
>;

export function normalizeConfigCheckoutEvent(input: {
  rawEventId: string;
  externalEventId?: string | null;
  idempotencyKey: string;
  receivedAt: Date;
  body: unknown;
}) {
  const envelope = object(input.body);
  const eventName = text(envelope?.type);
  const mapping = eventName
    ? eventMapping[eventName as keyof typeof eventMapping]
    : undefined;

  if (!envelope || !eventName || !mapping) {
    throw new ConfigCheckoutNormalizationBlocked(
      "unsupported_event",
      "Evento ausente ou não suportado.",
    );
  }

  const order = object(envelope.order);
  const buyer = object(order?.buyer);
  const product = object(order?.product);
  const amounts = object(order?.amounts);
  const gateway = object(order?.gateway);
  const checkout = object(order?.checkout);
  const attribution = object(order?.attribution);
  const utm = object(attribution?.utm);
  const email = normalizedEmail(buyer?.email);
  const orderToken = text(order?.token);
  const productName = text(product?.name);
  const kit = object(order?.kit);
  const kitName = text(kit?.name);
  const productExternalId =
    integer(product?.id) !== undefined
      ? String(integer(product?.id))
      : text(product?.sku);

  if (!order || !buyer || !email || !orderToken) {
    throw new ConfigCheckoutNormalizationBlocked(
      "missing_commercial_identity",
      "Pedido, comprador ou e-mail insuficiente para normalização.",
    );
  }

  if (!productName || !productExternalId) {
    throw new ConfigCheckoutNormalizationBlocked(
      "missing_products",
      "Nenhum produto válido foi informado.",
    );
  }

  const isTest = envelope.test;
  const scope =
    isTest === true
      ? ("test" as const)
      : isTest === false
        ? ("production" as const)
        : ("unknown" as const);
  const externalPaymentId = text(gateway?.payment_id);
  const originalAmount = money(amounts?.subtotal);
  const paidAmount = money(amounts?.total);
  const warnings: string[] = [];

  if (mapping.effect !== "none") {
    warnings.push("producer_commission_missing");
  }
  if (scope === "unknown") {
    warnings.push("is_test_missing_financial_effect_blocked");
  }
  if (!externalPaymentId && mapping.effect !== "none") {
    warnings.push("payment_id_missing_financial_effect_blocked");
  }

  let occurredAtRaw = text(envelope.occurred_at);
  let occurredAt = parseTimestampWithTimezone(occurredAtRaw);
  let occurredAtBasis = occurredAt ? "event_date" : "received_at_fallback";

  const preferredRaw =
    eventName === "payment.confirmed"
      ? text(order.paid_at)
      : eventName === "order.created"
        ? text(order.created_at)
        : undefined;
  if (preferredRaw) {
    const preferred = parseTimestampWithTimezone(preferredRaw);
    if (preferred) {
      occurredAtRaw = preferredRaw;
      occurredAt = preferred;
      occurredAtBasis =
        eventName === "payment.confirmed" ? "payment_date" : "created_at";
    }
  }

  if (!occurredAt) {
    occurredAt = input.receivedAt;
  }

  return {
    rawEventId: input.rawEventId,
    externalEventId: input.externalEventId ?? text(envelope.id),
    externalEventName: eventName,
    normalizedType: mapping.type,
    orderStatus: mapping.orderStatus,
    paymentStatus: mapping.paymentStatus,
    financialIntent: mapping.effect,
    scope,
    orderExternalKey: orderToken,
    person: {
      displayName: text(buyer.name),
      identifiers: [
        {
          type: "email" as const,
          normalizedValue: email,
          rawValue: text(buyer.email),
        },
        ...(normalizedPhone(buyer.phone)
          ? [
              {
                type: "phone" as const,
                normalizedValue: normalizedPhone(buyer.phone)!,
                rawValue: text(buyer.phone),
              },
            ]
          : []),
        ...(normalizedDocument(buyer.document)
          ? [
              {
                type: "document" as const,
                normalizedValue: normalizedDocument(buyer.document)!,
                rawValue: text(buyer.document),
              },
            ]
          : []),
      ],
    },
    products: [{ externalId: productExternalId, name: productName }],
    kitName,
    offer: checkout
      ? {
          externalId: `checkout:${integer(checkout.id) ?? text(checkout.id) ?? "principal"}`,
          name: text(checkout.name) ?? "Checkout",
          url: undefined,
        }
      : {
          externalId: `product:${productExternalId}`,
          name: productName,
          url: undefined,
        },
    payment: {
      externalPaymentId,
      status: mapping.paymentStatus,
      method: text(order.method),
      installments: integer(order.installments),
    },
    originalAmount,
    paidAmount,
    producerCommissionAmount: undefined as number | undefined,
    occurredAt,
    occurredAtRaw,
    occurredAtBasis,
    attribution: {
      utmSource: text(utm?.utm_source),
      utmMedium: text(utm?.utm_medium),
      utmCampaign: text(utm?.utm_campaign),
      utmTerm: text(utm?.utm_term),
      utmContent: text(utm?.utm_content),
      utmId: undefined,
      src: undefined,
      sck: undefined,
      vtid: undefined,
      originUrl: text(attribution?.domain)
        ? `https://${text(attribution?.domain)}`
        : undefined,
    },
    warnings,
    ruleVersion: configCheckoutRuleVersion,
  };
}
