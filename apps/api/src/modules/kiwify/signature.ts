import { createHmac, timingSafeEqual } from "node:crypto";

// Contrato oficial da Kiwify (docs.kiwify.com.br, "Receber e validar
// webhooks"): a entrega e um POST JSON com ?signature=<hmac-sha1-hex> na
// URL. A assinatura e o HMAC-SHA1 do corpo cru usando como chave o token
// cadastrado no webhook. O token nunca viaja na requisicao.

export function kiwifySignature(rawBody: Buffer, token: string) {
  return createHmac("sha1", token).update(rawBody).digest("hex");
}

export function verifyKiwifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  tokens: string[],
) {
  if (!signature) return false;
  const received = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return tokens.some((token) => {
    const expected = Buffer.from(kiwifySignature(rawBody, token), "utf8");
    return (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    );
  });
}
