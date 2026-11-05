import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Mesmo cofre das demais integracoes (integration_secrets): AES-256-GCM com
// a chave de INTEGRATION_SECRET_ENCRYPTION_KEY. O token da Kiwify e a chave
// do HMAC do webhook, entao ele precisa ser recuperavel (diferente da
// Ticto, cujo token viaja no corpo e e conferido por hash).

export function loadVaultKey(
  environment: Record<string, string | undefined> = process.env,
) {
  const encoded = environment.INTEGRATION_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("integration_vault_key_invalid");
  }
  return key;
}

export type StoredSecret = {
  ciphertext: Buffer | null;
  initializationVector: Buffer | null;
  authenticationTag: Buffer | null;
};

export function encryptStoredSecret(value: unknown, key: Buffer) {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext,
    initializationVector,
    authenticationTag: cipher.getAuthTag(),
  };
}

export function decryptStoredSecret(
  row: StoredSecret,
  key: Buffer,
): Record<string, unknown> {
  if (!row.ciphertext || !row.initializationVector || !row.authenticationTag) {
    return {};
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    row.initializationVector,
  );
  decipher.setAuthTag(row.authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(row.ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}
