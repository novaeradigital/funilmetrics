export const lastlinkRuleVersion = "lastlink-normalization-v2";

const eventMapping = {
  Abandoned_Cart: {
    type: "checkout_abandoned",
    orderStatus: "abandoned",
    paymentStatus: null,
    effect: "none",
  },
  Purchase_Request_Confirmed: {
    type: "payment_pending",
    orderStatus: "pending",
    paymentStatus: "pending",
    effect: "none",
  },
  Purchase_Order_Confirmed: {
    type: "payment_approved",
    orderStatus: "approved",
    paymentStatus: "approved",
    effect: "approve",
  },
  Purchase_Request_Expired: {
    type: "payment_request_expired",
    orderStatus: "expired",
    paymentStatus: "expired",
    effect: "none",
  },
  Purchase_Request_Canceled: {
    type: "payment_request_cancelled",
    orderStatus: "cancelled",
    paymentStatus: "cancelled",
    effect: "none",
  },
  Refund_Requested: {
    type: "refund_requested",
    orderStatus: "refund_requested",
    paymentStatus: "refund_requested",
    effect: "none",
  },
  Payment_Refund: {
    type: "payment_refunded",
    orderStatus: "refunded",
    paymentStatus: "refunded",
    effect: "reverse",
  },
  Payment_Chargeback: {
    type: "payment_chargeback",
    orderStatus: "chargeback",
    paymentStatus: "chargeback",
    effect: "reverse",
  },
} as const;

type JsonObject = Record<string, unknown>;

export class LastlinkNormalizationBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LastlinkNormalizationBlocked";
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

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizedEmail(value: unknown): string | undefined {
  const candidate = text(value)?.trim().toLowerCase();
  return candidate || undefined;
}

function normalizedPhone(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/[^\d+]/g, "");
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

export type NormalizedLastlinkEvent = ReturnType<
  typeof normalizeLastlinkEvent
>;

export function normalizeLastlinkEvent(input: {
  rawEventId: string;
  externalEventId?: string | null;
  idempotencyKey: string;
  receivedAt: Date;
  body: unknown;
}) {
  const envelope = object(input.body);
  const eventName = text(envelope?.Event);
  const mapping = eventName
    ? eventMapping[eventName as keyof typeof eventMapping]
    : undefined;

  if (!envelope || !eventName || !mapping) {
    throw new LastlinkNormalizationBlocked(
      "unsupported_event",
      "Evento ausente ou não suportado.",
    );
  }

  const data = object(envelope.Data);
  const buyer = object(data?.Buyer);
  const offer = object(data?.Offer);
  const purchase = object(data?.Purchase);
  const commissionsRaw = Array.isArray(data?.Commissions)
    ? data.Commissions
    : [];
  const payment = object(purchase?.Payment);
  const utm = object(data?.Utm);
  const productsRaw = Array.isArray(data?.Products) ? data.Products : [];
  const email = normalizedEmail(buyer?.Email);
  const offerExternalId = text(offer?.Id);

  if (!data || !buyer || !email || !offer || !offerExternalId) {
    throw new LastlinkNormalizationBlocked(
      "missing_commercial_identity",
      "Comprador, e-mail ou oferta insuficiente para normalização.",
    );
  }

  const products = productsRaw.flatMap((candidate) => {
    const product = object(candidate);
    const externalId = text(product?.Id);
    const name = text(product?.Name);
    return externalId && name ? [{ externalId, name }] : [];
  });

  if (products.length === 0) {
    throw new LastlinkNormalizationBlocked(
      "missing_products",
      "Nenhum produto válido foi informado.",
    );
  }

  const isTest = envelope.IsTest;
  const scope =
    isTest === true
      ? ("test" as const)
      : isTest === false
        ? ("production" as const)
        : ("unknown" as const);
  const externalPaymentId = text(purchase?.PaymentId);
  const originalAmount = number(object(purchase?.OriginalPrice)?.Value);
  const paidAmount = number(object(purchase?.Price)?.Value);
  const producerCommissionValues = commissionsRaw.flatMap((candidate) => {
    const commission = object(candidate);
    return text(commission?.Source)?.toUpperCase() === "PRODUCER" &&
      number(commission?.Value) !== undefined
      ? [number(commission?.Value)!]
      : [];
  });
  const producerCommissionAmount = producerCommissionValues.length
    ? producerCommissionValues.reduce((total, value) => total + value, 0)
    : undefined;
  const warnings: string[] = [];

  if (mapping.effect !== "none" && producerCommissionAmount === undefined) {
    warnings.push("producer_commission_missing");
  }

  let occurredAtRaw = text(envelope.CreatedAt);
  let occurredAt = parseTimestampWithTimezone(occurredAtRaw);
  let occurredAtBasis = occurredAt
    ? "created_at"
    : "received_at_fallback";

  const preferredDate =
    eventName === "Purchase_Order_Confirmed"
      ? text(purchase?.PaymentDate)
      : eventName === "Payment_Refund"
        ? text(purchase?.RefundDate)
        : eventName === "Payment_Chargeback"
          ? text(purchase?.ChargebackDate)
          : undefined;

  if (preferredDate) {
    const preferred = parseTimestampWithTimezone(preferredDate);
    if (preferred) {
      occurredAtRaw = preferredDate;
      occurredAt = preferred;
      occurredAtBasis =
        eventName === "Purchase_Order_Confirmed"
          ? "payment_date"
          : eventName === "Payment_Refund"
            ? "refund_date"
            : "chargeback_date";
    }
  } else if (
    eventName === "Payment_Refund" &&
    text(purchase?.ChargebackDate)
  ) {
    warnings.push("refund_has_chargeback_date_instead_of_refund_date");
  }

  if (!occurredAt) {
    occurredAt = input.receivedAt;
  }

  if (scope === "unknown") {
    warnings.push("is_test_missing_financial_effect_blocked");
  }
  if (!externalPaymentId && mapping.effect !== "none") {
    warnings.push("payment_id_missing_financial_effect_blocked");
  }

  return {
    rawEventId: input.rawEventId,
    externalEventId: input.externalEventId ?? text(envelope.Id),
    externalEventName: eventName,
    normalizedType: mapping.type,
    orderStatus: mapping.orderStatus,
    paymentStatus: mapping.paymentStatus,
    financialIntent: mapping.effect,
    scope,
    orderExternalKey:
      externalPaymentId ??
      `event:${input.externalEventId ?? input.idempotencyKey}`,
    person: {
      displayName: text(buyer.Name),
      identifiers: [
        {
          type: "email" as const,
          normalizedValue: email,
          rawValue: text(buyer.Email),
        },
        ...(normalizedPhone(buyer.PhoneNumber)
          ? [
              {
                type: "phone" as const,
                normalizedValue: normalizedPhone(buyer.PhoneNumber)!,
                rawValue: text(buyer.PhoneNumber),
              },
            ]
          : []),
        ...(text(buyer.Id)
          ? [
              {
                type: "lastlink_buyer_id" as const,
                normalizedValue: text(buyer.Id)!,
                rawValue: text(buyer.Id),
              },
            ]
          : []),
      ],
    },
    products,
    offer: {
      externalId: offerExternalId,
      name: text(offer.Name) ?? "Oferta sem nome",
      url: text(offer.Url),
    },
    payment: mapping.paymentStatus
      ? {
          externalPaymentId,
          status: mapping.paymentStatus,
          method: text(payment?.PaymentMethod),
          installments: number(payment?.NumberOfInstallments),
        }
      : undefined,
    originalAmount,
    paidAmount,
    producerCommissionAmount,
    occurredAt,
    occurredAtRaw,
    occurredAtBasis,
    attribution: {
      utmSource: text(utm?.UtmSource),
      utmMedium: text(utm?.UtmMedium),
      utmCampaign: text(utm?.UtmCampaign),
      utmTerm: text(utm?.UtmTerm),
      utmContent: text(utm?.UtmContent),
      utmId: text(utm?.UtmId),
      src: text(utm?.Src),
      sck: text(utm?.Sck),
      vtid: text(utm?.Vtid),
      originUrl: text(purchase?.OriginUrl),
    },
    warnings,
    ruleVersion: lastlinkRuleVersion,
  };
}
