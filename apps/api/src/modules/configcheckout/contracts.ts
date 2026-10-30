import { createHash } from "node:crypto";
import { z } from "zod";

export const knownConfigCheckoutEvents = [
  "order.created",
  "payment.confirmed",
  "payment.analysis",
  "payment.failed",
  "order.canceled",
  "order.refunded",
  "order.chargeback",
] as const;

const moneyText = z.string().regex(/^-?\d+(\.\d{1,2})?$/);

export const configCheckoutEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    version: z.number().int().positive(),
    occurred_at: z.string().min(1),
    test: z.boolean().optional(),
    seller: z
      .object({
        id: z.number().int().positive(),
      })
      .loose(),
    order: z.unknown(),
  })
  .loose();

const minimumOrderSchema = z
  .object({
    token: z.string().min(1),
    status: z.string().min(1),
    created_at: z.string().min(1),
    method: z.string().min(1),
    amounts: z
      .object({
        total: moneyText,
      })
      .loose(),
    product: z
      .object({
        name: z.string().min(1),
      })
      .loose(),
    buyer: z
      .object({
        email: z.string().min(1),
      })
      .loose(),
  })
  .loose();

export type ConfigCheckoutEnvelope = z.infer<typeof configCheckoutEnvelopeSchema>;
export type KnownConfigCheckoutEvent = (typeof knownConfigCheckoutEvents)[number];

export function isKnownEvent(value: string): value is KnownConfigCheckoutEvent {
  return knownConfigCheckoutEvents.includes(value as KnownConfigCheckoutEvent);
}

export function validateKnownEventData(order: unknown) {
  return minimumOrderSchema.safeParse(order);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }

  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function orderTokenFromEnvelope(envelope: ConfigCheckoutEnvelope) {
  const order = envelope.order;
  if (!order || typeof order !== "object") {
    return undefined;
  }

  const token = Reflect.get(order, "token");
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

export function preferredFieldWarnings(
  event: KnownConfigCheckoutEvent,
  envelope: ConfigCheckoutEnvelope,
) {
  const warnings: string[] = [];
  const order =
    envelope.order && typeof envelope.order === "object"
      ? (envelope.order as Record<string, unknown>)
      : {};

  if (event === "payment.confirmed" && !order.paid_at) {
    warnings.push("missing_paid_at");
  }

  const buyer =
    order.buyer && typeof order.buyer === "object"
      ? (order.buyer as Record<string, unknown>)
      : {};
  if (!buyer.phone) {
    warnings.push("missing_buyer_phone");
  }
  if (!buyer.document) {
    warnings.push("missing_buyer_document");
  }

  const attribution =
    order.attribution && typeof order.attribution === "object"
      ? (order.attribution as Record<string, unknown>)
      : {};
  if (!attribution.utm && !attribution.fbc && !attribution.fbp) {
    warnings.push("missing_attribution");
  }

  return warnings;
}
