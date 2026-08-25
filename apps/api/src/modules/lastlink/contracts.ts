import { createHash } from "node:crypto";
import { z } from "zod";

export const knownLastlinkEvents = [
  "Abandoned_Cart",
  "Purchase_Request_Confirmed",
  "Purchase_Order_Confirmed",
  "Purchase_Request_Expired",
  "Purchase_Request_Canceled",
  "Refund_Requested",
  "Payment_Refund",
  "Payment_Chargeback",
] as const;

export const lastlinkEnvelopeSchema = z
  .object({
    Id: z.string().optional(),
    IsTest: z.boolean().optional(),
    Event: z.string().min(1),
    CreatedAt: z.string().min(1),
    Data: z.unknown(),
  })
  .loose();

const minimumKnownEventDataSchema = z
  .object({
    Products: z.array(z.unknown()).min(1),
    Buyer: z
      .object({
        Email: z.string().min(1),
      })
      .loose(),
    Offer: z
      .object({
        Id: z.string().min(1),
        Name: z.string().min(1),
      })
      .loose(),
  })
  .loose();

export type LastlinkEnvelope = z.infer<typeof lastlinkEnvelopeSchema>;
export type KnownLastlinkEvent = (typeof knownLastlinkEvents)[number];

export function isKnownEvent(value: string): value is KnownLastlinkEvent {
  return knownLastlinkEvents.includes(value as KnownLastlinkEvent);
}

export function validateKnownEventData(data: unknown) {
  return minimumKnownEventDataSchema.safeParse(data);
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

export function paymentIdFromData(data: unknown) {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const purchase = Reflect.get(data, "Purchase");
  if (!purchase || typeof purchase !== "object") {
    return undefined;
  }

  const paymentId = Reflect.get(purchase, "PaymentId");
  return typeof paymentId === "string" && paymentId.trim()
    ? paymentId.trim()
    : undefined;
}

export function preferredFieldWarnings(
  event: KnownLastlinkEvent,
  data: unknown,
) {
  const warnings: string[] = [];
  const paymentId = paymentIdFromData(data);
  const purchase =
    data && typeof data === "object" ? Reflect.get(data, "Purchase") : undefined;

  const purchaseField = (name: string) =>
    purchase && typeof purchase === "object"
      ? Reflect.get(purchase, name)
      : undefined;

  if (
    [
      "Purchase_Order_Confirmed",
      "Refund_Requested",
      "Payment_Refund",
      "Payment_Chargeback",
    ].includes(event) &&
    !paymentId
  ) {
    warnings.push("missing_payment_id");
  }

  if (
    event === "Purchase_Order_Confirmed" &&
    !purchaseField("PaymentDate")
  ) {
    warnings.push("missing_payment_date");
  }

  if (event === "Payment_Refund" && !purchaseField("RefundDate")) {
    warnings.push("missing_refund_date");
  }

  if (event === "Payment_Chargeback" && !purchaseField("ChargebackDate")) {
    warnings.push("missing_chargeback_date");
  }

  return warnings;
}
