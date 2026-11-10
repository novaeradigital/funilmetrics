import { createHash } from "node:crypto";
import { z } from "zod";

// Contrato do webhook emitido pelo checkout proprio da Madame Luna
// (app.madameluna.online e tr.rotasdigital.com.br). Diferente das
// plataformas, aqui o contrato e nosso: o app da Luna monta o payload e
// assina com o segredo da conexao (HMAC-SHA256 no cabecalho). Valores em
// REAIS (numero decimal), nao em centavos. Os dois sistemas usam a mesma
// conexao; o campo system separa as vendas de cada um e entra nas chaves
// externas para os ids de pagamento nao colidirem.

const trackingSchema = z
  .object({
    utm_source: z.string().nullable().optional(),
    utm_medium: z.string().nullable().optional(),
    utm_campaign: z.string().nullable().optional(),
    utm_content: z.string().nullable().optional(),
    utm_term: z.string().nullable().optional(),
    fbclid: z.string().nullable().optional(),
    fbp: z.string().nullable().optional(),
    fbc: z.string().nullable().optional(),
    sck: z.string().nullable().optional(),
  })
  .optional();

export const madameLunaPayloadSchema = z
  .object({
    event: z.string().min(1),
    occurred_at: z.string().optional(),
    system: z.enum(["app", "tr"]),
    payment: z.object({
      id: z.string().min(1),
      gateway_id: z.string().nullable().optional(),
      product_id: z.string().min(1),
      product_name: z.string().min(1),
      amount: z.number(),
      net_amount: z.number().nullable().optional(),
      currency: z.string().optional(),
      method: z.string().nullable().optional(),
      installments: z.number().nullable().optional(),
    }),
    customer: z.object({
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      cpf: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    }),
    tracking: trackingSchema,
  })
  .passthrough();

export type MadameLunaPayload = z.infer<typeof madameLunaPayloadSchema>;

// Eventos processados nesta versao: aprovacao vira venda; reembolso e
// chargeback revertem o efeito financeiro.
const supportedEventTypes = new Set([
  "payment_approved",
  "payment_refunded",
  "payment_chargeback",
]);

export function isSupportedMadameLunaEventType(eventType: string) {
  return supportedEventTypes.has(eventType);
}

export function madameLunaExternalEventId(
  system: string,
  paymentId: string,
  eventType: string,
) {
  // Idempotencia contra reenvios do emissor: sistema + pagamento + evento.
  return `madame_luna:${system}:${paymentId}:${eventType}`;
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
