import { describe, expect, it, vi } from "vitest";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "./integration-vault.js";

vi.mock("server-only", () => ({}));

describe("integration vault", () => {
  it("fica desligado sem chave e rejeita tamanho inválido", () => {
    expect(loadIntegrationVaultKey({})).toBeNull();
    expect(() =>
      loadIntegrationVaultKey({ INTEGRATION_SECRET_ENCRYPTION_KEY: "bad" }),
    ).toThrow("integration_vault_key_invalid");
  });

  it("cifra o bundle sem preservar o segredo em texto puro", () => {
    const key = Buffer.alloc(32, 4);
    const encrypted = encryptIntegrationSecret({ apiKey: "sk-secret" }, key);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("sk-secret");
    expect(encrypted.initializationVector).toHaveLength(12);
    expect(encrypted.authenticationTag).toHaveLength(16);
    expect(decryptIntegrationSecret(encrypted, key)).toEqual({
      apiKey: "sk-secret",
    });
  });
});
