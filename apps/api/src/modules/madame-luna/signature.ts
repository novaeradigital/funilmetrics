import { createHmac, timingSafeEqual } from "node:crypto";

// Assinatura do webhook da Madame Luna: HMAC-SHA256 do corpo cru com o
// segredo da conexao como chave, em hexadecimal, enviado no cabecalho
// x-madame-luna-signature no formato "sha256=<hex>" (o emissor e o app
// da Luna; o segredo nunca viaja na requisicao).

export function madameLunaSignature(rawBody: Buffer, secret: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyMadameLunaSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secrets: string[],
) {
  if (!signature) return false;
  const received = Buffer.from(
    signature.trim().toLowerCase().replace(/^sha256=/, ""),
    "utf8",
  );
  return secrets.some((secret) => {
    const expected = Buffer.from(madameLunaSignature(rawBody, secret), "utf8");
    return (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    );
  });
}
