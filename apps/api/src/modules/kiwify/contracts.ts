import { createHash } from "node:crypto";
import { z } from "zod";

// Payload do webhook da Kiwify (painel Apps > Webhooks), conforme a
// documentacao oficial e o modelo de payload publicado: pedido no topo,
// Product, Customer, Commissions (valores em CENTAVOS como string) e
// TrackingParameters com o sck que casa a venda com o visitante.

export const kiwifyPayloadSchema = z
  .object({
    order_id: z.string().min(1),
    order_ref: z.string().optional(),
    order_status: z.string().min(1),
    webhook_event_type: z.string().min(1),
    payment_method: z.string().optional(),
    installments: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    approved_date: z.string().nullable().optional(),
    refunded_at: z.string().nullable().optional(),
    Product: z.object({
      product_id: z.string().min(1),
      product_name: z.string().min(1),
    }),
    Customer: z.object({
      full_name: z.string().optional(),
      email: z.string().min(3),
      mobile: z.string().nullable().optional(),
      CPF: z.string().nullable().optional(),
      ip: z.string().nullable().optional(),
    }),
    Commissions: z.object({
      charge_amount: z.union([z.string(), z.number()]),
      product_base_price: z
        .union([z.string(), z.number()])
        .nullable()
        .optional(),
      my_commission: z.union([z.string(), z.number()]).nullable().optional(),
    }),
    TrackingParameters: z
      .object({
        src: z.string().nullable().optional(),
        sck: z.string().nullable().optional(),
        utm_source: z.string().nullable().optional(),
        utm_medium: z.string().nullable().optional(),
        utm_campaign: z.string().nullable().optional(),
        utm_content: z.string().nullable().optional(),
        utm_term: z.string().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

export type KiwifyPayload = z.infer<typeof kiwifyPayloadSchema>;

// Eventos de pedido processados nesta versao. Os eventos de assinatura
// (subscription_canceled e subscription_late) sao conhecidos, mas ficam
// em quarentena ate o desenho de assinaturas; subscription_renewed e
// processado pelo status do pedido que o acompanha.
const supportedEventTypes = new Set([
  "order_approved",
  "order_refunded",
  "chargeback",
  "billet_created",
  "pix_created",
  "order_rejected",
  "subscription_renewed",
]);

export function isSupportedKiwifyEventType(eventType: string) {
  return supportedEventTypes.has(eventType);
}

export function kiwifyExternalEventId(orderId: string, eventType: string) {
  // A propria Kiwify recomenda a combinacao order_id + webhook_event_type
  // como chave de idempotencia contra reenvios e replay.
  return `kiwify:${orderId}:${eventType}`;
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
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
