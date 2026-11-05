export const kiwifyRuleVersion = "kiwify-normalization-v1";

// Espelho do mapeamento da Ticto/Lastlink: mesma forma de saida para o
// processador compartilhar person/offer/order/payment/efeito financeiro.
// Valores da Kiwify vem em CENTAVOS como string (Commissions) e as datas
// sem fuso ("2026-11-04 12:01"), lidas como horario de Brasilia.

type OrderStatus =
  | "pending"
  | "approved"
  | "cancelled"
  | "refunded"
  | "chargeback"
  | "abandoned"
  | "expired"
  | "refund_requested";
type PaymentStatus =
  | "pending"
  | "approved"
  | "cancelled"
  | "refunded"
  | "chargeback"
  | "expired"
  | "refund_requested";

type Mapping = {
  type: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus | null;
  effect: "approve" | "reverse" | "none";
};

const approvedMapping: Mapping = {
  type: "payment_approved",
  orderStatus: "approved",
  paymentStatus: "approved",
  effect: "approve",
};
const refundedMapping: Mapping = {
  type: "payment_refunded",
  orderStatus: "refunded",
  paymentStatus: "refunded",
  effect: "reverse",
};
const chargebackMapping: Mapping = {
  type: "payment_chargeback",
  orderStatus: "chargeback",
  paymentStatus: "chargeback",
  effect: "reverse",
};
const pendingMapping: Mapping = {
  type: "payment_pending",
  orderStatus: "pending",
  paymentStatus: "pending",
  effect: "none",
};

function mappingFor(eventType: string, orderStatus: string): Mapping | null {
  switch (eventType) {
    case "order_approved":
      return approvedMapping;
    case "order_refunded":
      return refundedMapping;
    case "chargeback":
      return chargebackMapping;
    case "billet_created":
    case "pix_created":
      return pendingMapping;
    case "order_rejected":
      return {
        type: "payment_request_cancelled",
        orderStatus: "cancelled",
        paymentStatus: "cancelled",
        effect: "none",
      };
    case "subscription_renewed":
      if (orderStatus === "paid") return approvedMapping;
      if (orderStatus === "refunded") return refundedMapping;
      if (orderStatus === "chargedback") return chargebackMapping;
      return pendingMapping;
    default:
      return null;
  }
}

type JsonObject = Record<string, unknown>;

export class KiwifyNormalizationBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KiwifyNormalizationBlocked";
  }
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function cents(value: unknown): number | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount / 100 : undefined;
}

function normalizedEmail(value: unknown): string | undefined {
  const candidate = text(value)?.trim().toLowerCase();
  return candidate || undefined;
}

function normalizedPhone(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/[^\d+]/g, "");
  return candidate || undefined;
}

function parseKiwifyDate(value: unknown, fallback: Date) {
  const raw = text(value)?.trim();
  if (!raw) return { at: fallback, raw: undefined, basis: "received_at_fallback" };
  let candidate = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    candidate = `${raw.replace(" ", "T")}-03:00`;
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) {
    candidate = `${raw.replace(" ", "T")}:00-03:00`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    candidate = `${raw}T00:00:00-03:00`;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return { at: fallback, raw, basis: "received_at_fallback" };
  }
  return { at: parsed, raw, basis: "provider_date" };
}

export type NormalizedKiwifyEvent = ReturnType<typeof normalizeKiwifyEvent>;

export function normalizeKiwifyEvent(input: {
  rawEventId: string;
  externalEventId?: string | null;
  idempotencyKey: string;
  receivedAt: Date;
  body: unknown;
}) {
  const payload = object(input.body);
  const eventType = text(payload?.webhook_event_type);
  const orderStatus = text(payload?.order_status);
  const mapping =
    eventType && orderStatus ? mappingFor(eventType, orderStatus) : null;

  if (!payload || !eventType || !orderStatus || !mapping) {
    throw new KiwifyNormalizationBlocked(
      "unsupported_event",
      "Evento ou status ausente ou não suportado.",
    );
  }

  const product = object(payload.Product);
  const customer = object(payload.Customer);
  const commissions = object(payload.Commissions);
  const tracking = object(payload.TrackingParameters);
  const email = normalizedEmail(customer?.email);

  if (!customer || !email || !product) {
    throw new KiwifyNormalizationBlocked(
      "missing_commercial_identity",
      "Comprador, e-mail ou produto insuficiente para normalização.",
    );
  }

  const productExternalId = text(product.product_id);
  const productName = text(product.product_name);
  if (!productExternalId || !productName) {
    throw new KiwifyNormalizationBlocked(
      "missing_products",
      "Nenhum produto válido foi informado.",
    );
  }

  const orderId = text(payload.order_id);
  const externalPaymentId = orderId;
  const paidAmount = cents(commissions?.charge_amount);
  const originalAmount = cents(commissions?.product_base_price);
  const producerCommissionAmount = cents(commissions?.my_commission);
  const warnings: string[] = [];
  if (producerCommissionAmount === undefined) {
    warnings.push("producer_commission_missing");
  }
  if (!externalPaymentId && mapping.effect !== "none") {
    warnings.push("payment_id_missing_financial_effect_blocked");
  }

  const occurred = parseKiwifyDate(
    eventType === "order_refunded"
      ? (payload.refunded_at ?? payload.updated_at ?? payload.created_at)
      : mapping.effect === "approve"
        ? (payload.approved_date ?? payload.updated_at ?? payload.created_at)
        : (payload.updated_at ?? payload.created_at),
    input.receivedAt,
  );
  const phone = normalizedPhone(customer.mobile);
  const cpf = text(customer.CPF)?.replace(/\D/g, "");

  return {
    rawEventId: input.rawEventId,
    externalEventId: input.externalEventId ?? undefined,
    externalEventName: eventType,
    normalizedType: mapping.type,
    orderStatus: mapping.orderStatus,
    paymentStatus: mapping.paymentStatus,
    financialIntent: mapping.effect,
    scope: "production" as const,
    orderExternalKey:
      orderId ??
      externalPaymentId ??
      `event:${input.externalEventId ?? input.idempotencyKey}`,
    person: {
      displayName: text(customer.full_name),
      identifiers: [
        {
          type: "email" as const,
          normalizedValue: email,
          rawValue: text(customer.email),
        },
        ...(phone
          ? [
              {
                type: "phone" as const,
                normalizedValue: phone,
                rawValue: phone,
              },
            ]
          : []),
        ...(cpf
          ? [
              {
                type: "document" as const,
                normalizedValue: cpf,
                rawValue: text(customer.CPF),
              },
            ]
          : []),
      ],
    },
    products: [{ externalId: productExternalId, name: productName }],
    offer: {
      externalId: productExternalId,
      name: productName,
      url: undefined as string | undefined,
    },
    payment: mapping.paymentStatus
      ? {
          externalPaymentId,
          status: mapping.paymentStatus,
          method: text(payload.payment_method),
          installments: number(payload.installments),
        }
      : undefined,
    originalAmount,
    paidAmount,
    producerCommissionAmount,
    occurredAt: occurred.at,
    occurredAtRaw: occurred.raw,
    occurredAtBasis: occurred.basis,
    attribution: {
      utmSource: text(tracking?.utm_source),
      utmMedium: text(tracking?.utm_medium),
      utmCampaign: text(tracking?.utm_campaign),
      utmTerm: text(tracking?.utm_term),
      utmContent: text(tracking?.utm_content),
      utmId: undefined as string | undefined,
      src: text(tracking?.src),
      sck: text(tracking?.sck),
      vtid: undefined as string | undefined,
      originUrl: undefined as string | undefined,
    },
    buyerAddress: {
      city: undefined as string | undefined,
      state: undefined as string | undefined,
      zip: undefined as string | undefined,
      country: "BR",
    },
    warnings,
    ruleVersion: kiwifyRuleVersion,
  };
}
