export const madameLunaRuleVersion = "madame-luna-normalization-v1";

// Normalizacao dos eventos emitidos pelo checkout proprio da Madame
// Luna. Mesma forma de saida dos demais provedores para o processador
// compartilhar person/offer/order/payment/efeito financeiro. Diferencas
// do contrato da Luna: valores em REAIS (numero), a identidade aceita
// CPF sem e-mail (a consulta nao pede e-mail no pagamento; e-mail so
// existe nas ofertas do clube e do vitalicio) e as chaves externas
// carregam o sistema de origem (app ou tr) porque os dois dividem a
// mesma conexao e os ids de pagamento sao locais de cada base.

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

const mappingByEvent: Record<string, Mapping> = {
  payment_approved: {
    type: "payment_approved",
    orderStatus: "approved",
    paymentStatus: "approved",
    effect: "approve",
  },
  payment_refunded: {
    type: "payment_refunded",
    orderStatus: "refunded",
    paymentStatus: "refunded",
    effect: "reverse",
  },
  payment_chargeback: {
    type: "payment_chargeback",
    orderStatus: "chargeback",
    paymentStatus: "chargeback",
    effect: "reverse",
  },
};

type JsonObject = Record<string, unknown>;

export class MadameLunaNormalizationBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MadameLunaNormalizationBlocked";
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

function normalizedEmail(value: unknown): string | undefined {
  const candidate = text(value)?.trim().toLowerCase();
  return candidate || undefined;
}

function normalizedPhone(value: unknown): string | undefined {
  const candidate = text(value)?.replace(/[^\d+]/g, "");
  return candidate || undefined;
}

function parseEventDate(value: unknown, fallback: Date) {
  const raw = text(value)?.trim();
  if (!raw) return { at: fallback, raw: undefined, basis: "received_at_fallback" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { at: fallback, raw, basis: "received_at_fallback" };
  }
  return { at: parsed, raw, basis: "provider_date" };
}

export type NormalizedMadameLunaEvent = ReturnType<
  typeof normalizeMadameLunaEvent
>;

export function normalizeMadameLunaEvent(input: {
  rawEventId: string;
  externalEventId?: string | null;
  idempotencyKey: string;
  receivedAt: Date;
  body: unknown;
}) {
  const payload = object(input.body);
  const eventType = text(payload?.event);
  const mapping = eventType ? mappingByEvent[eventType] : undefined;

  if (!payload || !eventType || !mapping) {
    throw new MadameLunaNormalizationBlocked(
      "unsupported_event",
      "Evento ausente ou não suportado.",
    );
  }

  const system = text(payload.system);
  const payment = object(payload.payment);
  const customer = object(payload.customer);
  const tracking = object(payload.tracking);

  const email = normalizedEmail(customer?.email);
  const cpf = text(customer?.cpf)?.replace(/\D/g, "") || undefined;
  const phone = normalizedPhone(customer?.phone);

  if (!payment || !customer || (!email && !cpf)) {
    throw new MadameLunaNormalizationBlocked(
      "missing_commercial_identity",
      "Comprador sem e-mail nem CPF para normalização.",
    );
  }
  if (system !== "app" && system !== "tr") {
    throw new MadameLunaNormalizationBlocked(
      "missing_system",
      "Sistema de origem (app ou tr) ausente ou inválido.",
    );
  }

  const productExternalId = text(payment.product_id);
  const productName = text(payment.product_name);
  if (!productExternalId || !productName) {
    throw new MadameLunaNormalizationBlocked(
      "missing_products",
      "Nenhum produto válido foi informado.",
    );
  }

  const paymentLocalId = text(payment.id);
  if (!paymentLocalId) {
    throw new MadameLunaNormalizationBlocked(
      "missing_payment_id",
      "Id do pagamento ausente.",
    );
  }
  // Chaves externas com o sistema: os ids de pagamento sao locais de
  // cada base (app e tr) e a conexao e uma so.
  const externalKey = `${system}:${paymentLocalId}`;

  const paidAmount = number(payment.amount);
  const producerCommissionAmount = number(payment.net_amount);
  const warnings: string[] = [];
  if (producerCommissionAmount === undefined) {
    // Regra D-136: sem liquido no payload, o estagio Liquido mostra
    // indisponivel; nunca inventar.
    warnings.push("producer_commission_missing");
  }
  if (paidAmount === undefined && mapping.effect !== "none") {
    warnings.push("amount_missing_financial_effect_blocked");
  }

  const occurred = parseEventDate(payload.occurred_at, input.receivedAt);

  return {
    rawEventId: input.rawEventId,
    externalEventId: input.externalEventId ?? undefined,
    externalEventName: eventType,
    normalizedType: mapping.type,
    orderStatus: mapping.orderStatus,
    paymentStatus: mapping.paymentStatus,
    financialIntent: mapping.effect,
    scope: "production" as const,
    orderExternalKey: externalKey,
    person: {
      displayName: text(customer.name),
      identifiers: [
        ...(email
          ? [
              {
                type: "email" as const,
                normalizedValue: email,
                rawValue: text(customer.email),
              },
            ]
          : []),
        ...(cpf
          ? [
              {
                type: "document" as const,
                normalizedValue: cpf,
                rawValue: text(customer.cpf),
              },
            ]
          : []),
        ...(phone
          ? [
              {
                type: "phone" as const,
                normalizedValue: phone,
                rawValue: phone,
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
          externalPaymentId: externalKey,
          status: mapping.paymentStatus,
          method: text(payment.method),
          installments: number(payment.installments),
        }
      : undefined,
    originalAmount: paidAmount,
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
      src: undefined as string | undefined,
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
    ruleVersion: madameLunaRuleVersion,
  };
}
