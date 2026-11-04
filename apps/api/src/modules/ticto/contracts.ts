import { createHash } from "node:crypto";
import { z } from "zod";

// Webhook Ticto 2.0 (https://webhook.ticto.dev/docs/v2): o corpo traz o
// objeto da venda no nivel raiz, com `status`, `token` de seguranca gerado
// pela Ticto, `order`, `item`, `customer`, `tracking` (utm/src/sck) e
// `url_params`. Diferente da Lastlink, nao ha envelope Id/Event/CreatedAt.

export const tictoPayloadSchema = z
  .object({
    version: z.string().optional(),
    status: z.string().min(1),
    token: z.string().min(1),
    status_date: z.string().optional(),
    payment_method: z.string().optional(),
    order: z
      .object({
        id: z.union([z.number(), z.string()]).optional(),
        hash: z.string().optional(),
        transaction_hash: z.string().optional(),
        paid_amount: z.number().optional(),
        installments: z.number().optional(),
        order_date: z.string().optional(),
      })
      .passthrough()
      .optional(),
    item: z.object({}).passthrough().optional(),
    customer: z.object({}).passthrough().optional(),
    tracking: z.object({}).passthrough().optional(),
    url_params: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional(),
  })
  .passthrough();

export type TictoPayload = z.infer<typeof tictoPayloadSchema>;

export const knownTictoStatuses = new Set([
  "authorized",
  "refunded",
  "chargeback",
  "abandoned_cart",
  "pix_created",
  "pix_expired",
  "bank_slip_created",
  "waiting_payment",
  "refused",
]);

export function isKnownTictoStatus(status: string) {
  return knownTictoStatuses.has(status);
}

export function sha256(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function tictoExternalEventId(payload: TictoPayload) {
  const orderHash = payload.order?.hash?.trim();
  if (orderHash) return `ticto:${orderHash}:${payload.status}`;
  const transaction = payload.order?.transaction_hash?.trim();
  if (transaction) return `ticto:tx:${transaction}:${payload.status}`;
  return undefined;
}
