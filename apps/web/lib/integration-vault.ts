import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function loadIntegrationVaultKey(
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

export function encryptIntegrationSecret(value: unknown, key: Buffer) {
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

export function decryptIntegrationSecret(
  encrypted: {
    ciphertext: Buffer;
    initializationVector: Buffer;
    authenticationTag: Buffer;
  },
  key: Buffer,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encrypted.initializationVector,
  );
  decipher.setAuthTag(encrypted.authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}
