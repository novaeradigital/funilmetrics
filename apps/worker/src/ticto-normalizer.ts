export const tictoRuleVersion = "ticto-normalization-v1";

// Espelho do mapeamento da Lastlink (lastlink-normalizer.ts): mesma forma de
// saida para o processador compartilhar person/offer/order/payment/efeito
// financeiro. Valores monetarios da Ticto vem em centavos.

const statusMapping = {
  authorized: {
    type: "payment_approved",
    orderStatus: "approved",
    paymentStatus: "approved",
    effect: "approve",
  },
  abandoned_cart: {
    type: "checkout_abandoned",
    orderStatus: "abandoned",
    paymentStatus: null,
    effect: "none",
  },
  pix_created: {
    type: "payment_pending",
    orderStatus: "pending",
    paymentStatus: "pending",
    effect: "none",
  },
  bank_slip_created: {
    type: "payment_pending",
    orderStatus: "pending",
    paymentStatus: "pending",
    effect: "none",
  },
  waiting_payment: {
    type: "payment_pending",
    orderStatus: "pending",
    paymentStatus: "pending",
    effect: "none",
  },
  pix_expired: {
    type: "payment_request_expired",
    orderStatus: "expired",
    paymentStatus: "expired",
    effect: "none",
  },
  refused: {
    type: "payment_request_cancelled",
    orderStatus: "cancelled",
    paymentStatus: "cancelled",
    effect: "none",
  },
  refunded: {
    type: "payment_refunded",
    orderStatus: "refunded",
    paymentStatus: "refunded",
    effect: "reverse",
  },
  chargeback: {
    type: "payment_chargeback",
    orderStatus: "chargeback",
    paymentStatus: "chargeback",
    effect: "reverse",
  },
} as const;

type JsonObject = Record<string, unknown>;

export class TictoNormalizationBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TictoNormalizationBlocked";
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
  const amount = number(value);
  return amount === undefined ? undefined : amount / 100;
}

function normalizedEmail(value: unknown): string | undefined {
  const candidate = text(value)?.trim().toLowerCase();
  return candidate || undefined;
}

function normalizedPhone(customer: JsonObject | undefined): string | undefined {
  const raw = customer?.phone;
  const phoneObject = object(raw);
  if (phoneObject) {
    const digits = [phoneObject.ddi, phoneObject.ddd, phoneObject.number]
      .map((part) => text(part)?.replace(/\D/g, "") ?? "")
      .join("");
    return digits ? `+${digits}` : undefined;
  }
  const candidate = text(raw)?.replace(/[^\d+]/g, "");
  return candidate || undefined;
}

function parseTictoDate(value: unknown, fallback: Date) {
  const raw = text(value)?.trim();
  if (!raw) return { at: fallback, raw: undefined, basis: "received_at_fallback" };
  let candidate = raw;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    candidate = `${raw.replace(" ", "T")}-03:00`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    candidate = `${raw}T00:00:00-03:00`;
  }
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return { at: fallback, raw, basis: "received_at_fallback" };
  }
  return { at: parsed, raw, basis: "status_date" };
}

export type NormalizedTictoEvent = ReturnType<typeof normalizeTictoEvent>;

export function normalizeTictoEvent(input: {
  rawEventId: string;
  externalEventId?: string | null;
  idempotencyKey: string;
  receivedAt: Date;
  body: unknown;
}) {
  const payload = object(input.body);
  const status = text(payload?.status);
  const mapping = status
    ? statusMapping[status as keyof typeof statusMapping]
    : undefined;

  if (!payload || !status || !mapping) {
    throw new TictoNormalizationBlocked(
      "unsupported_event",
      "Status ausente ou não suportado.",
    );
  }

  const order = object(payload.order);
  const item = object(payload.item);
  const customer = object(payload.customer);
  const tracking = object(payload.tracking);
  const email = normalizedEmail(customer?.email);

  if (!customer || !email || !item) {
    throw new TictoNormalizationBlocked(
      "missing_commercial_identity",
      "Comprador, e-mail ou item insuficiente para normalização.",
    );
  }

  const productExternalId = text(item.product_id) ?? text(item.offer_id);
  const productName = text(item.product_name);
  const products: Array<{ externalId: string; name: string }> = [];
  if (productExternalId && productName) {
    products.push({ externalId: productExternalId, name: productName });
  }
  const bumps = Array.isArray(payload.bumps) ? payload.bumps : [];
  for (const candidate of bumps) {
    const bump = object(candidate);
    const bumpId = text(bump?.product_id) ?? text(bump?.offer_id);
    const bumpName = text(bump?.product_name) ?? text(bump?.offer_name);
    if (bumpId && bumpName) {
      products.push({ externalId: bumpId, name: bumpName });
    }
  }
  if (products.length === 0) {
    throw new TictoNormalizationBlocked(
      "missing_products",
      "Nenhum produto válido foi informado.",
    );
  }

  const offerExternalId =
    text(item.offer_code) ?? text(item.offer_id) ?? productExternalId!;
  const scope =
    payload.is_test === true || payload.test === true
      ? ("test" as const)
      : ("production" as const);
  const externalPaymentId = text(order?.transaction_hash) ?? text(order?.hash);
  const paidAmount = cents(order?.paid_amount);
  const originalAmount = cents(item.amount);
  const warnings: string[] = ["producer_commission_missing"];
  if (!externalPaymentId && mapping.effect !== "none") {
    warnings.push("payment_id_missing_financial_effect_blocked");
  }

  const occurred = parseTictoDate(payload.status_date, input.receivedAt);
  const phone = normalizedPhone(customer);
  const cpf = text(customer.cpf)?.replace(/\D/g, "");
  const address = object(customer.address);

  return {
    rawEventId: input.rawEventId,
    externalEventId: input.externalEventId ?? undefined,
    externalEventName: status,
    normalizedType: mapping.type,
    orderStatus: mapping.orderStatus,
    paymentStatus: mapping.paymentStatus,
    financialIntent: mapping.effect,
    scope,
    orderExternalKey:
      text(order?.hash) ??
      externalPaymentId ??
      `event:${input.externalEventId ?? input.idempotencyKey}`,
    person: {
      displayName: text(customer.name),
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
                type: "cpf" as const,
                normalizedValue: cpf,
                rawValue: text(customer.cpf),
              },
            ]
          : []),
      ],
    },
    products,
    offer: {
      externalId: offerExternalId,
      name: text(item.offer_name) ?? productName ?? "Oferta sem nome",
      url: text(payload.checkout_url),
    },
    payment: mapping.paymentStatus
      ? {
          externalPaymentId,
          status: mapping.paymentStatus,
          method: text(payload.payment_method),
          installments: number(order?.installments),
        }
      : undefined,
    originalAmount,
    paidAmount,
    producerCommissionAmount: undefined as number | undefined,
    occurredAt: occurred.at,
    occurredAtRaw: occurred.raw,
    occurredAtBasis: occurred.basis,
    attribution: {
      utmSource: text(tracking?.utm_source) ?? text(tracking?.utmSource),
      utmMedium: text(tracking?.utm_medium) ?? text(tracking?.utmMedium),
      utmCampaign: text(tracking?.utm_campaign) ?? text(tracking?.utmCampaign),
      utmTerm: text(tracking?.utm_term) ?? text(tracking?.utmTerm),
      utmContent: text(tracking?.utm_content) ?? text(tracking?.utmContent),
      utmId: text(tracking?.utm_id) ?? text(tracking?.utmId),
      src: text(tracking?.src),
      sck: text(tracking?.sck),
      vtid: text(tracking?.vtid),
      originUrl: text(payload.checkout_url),
    },
    buyerAddress: {
      city: text(address?.city),
      state: text(address?.state),
      zip: text(address?.zip_code) ?? text(address?.zipcode) ?? text(address?.cep),
      country: text(address?.country) ?? "BR",
    },
    warnings,
    ruleVersion: tictoRuleVersion,
  };
}
