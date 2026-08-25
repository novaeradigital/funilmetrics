import { describe, expect, it } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  createOAuthState,
  decryptRefreshToken,
  encryptRefreshToken,
  loadGoogleOAuthConfig,
  loadGooglePickerConfig,
  verifyOAuthState,
} from "./google-drive-oauth.js";

const config = {
  clientId: "client",
  clientSecret: "secret",
  redirectUri: "https://example.com/callback",
  stateSecret: "s".repeat(32),
  encryptionKey: Buffer.alloc(32, 7),
};

describe("Google Drive OAuth", () => {
  it("fica desligado sem configuração e rejeita configuração parcial", () => {
    expect(loadGoogleOAuthConfig({})).toBeNull();
    expect(() => loadGoogleOAuthConfig({ GOOGLE_CLIENT_ID: "client" })).toThrow(
      "google_oauth_configuration_incomplete",
    );
  });

  it("assina, valida e rejeita adulteração do state", () => {
    const state = createOAuthState(
      { userId: "user", projectId: "project", nonce: "nonce" },
      config.stateSecret,
    );
    expect(verifyOAuthState(state, config.stateSecret)).toMatchObject({
      userId: "user",
      projectId: "project",
      nonce: "nonce",
    });
    expect(() =>
      verifyOAuthState(`${state}x`, config.stateSecret),
    ).toThrow("oauth_state_invalid");
  });

  it("solicita acesso offline e leitura do Drive sem permissão de escrita", () => {
    const url = buildGoogleAuthorizationUrl(config, "state");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("/auth/drive.readonly");
    expect(url.searchParams.get("scope")).not.toContain("/auth/drive ");
  });

  it("criptografa refresh token com AES-GCM sem preservar texto puro", () => {
    const encrypted = encryptRefreshToken("refresh-secret", config.encryptionKey);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("refresh-secret");
    expect(encrypted.initializationVector).toHaveLength(12);
    expect(encrypted.authenticationTag).toHaveLength(16);
    expect(decryptRefreshToken(encrypted, config.encryptionKey)).toBe(
      "refresh-secret",
    );
  });

  it("valida a configuração pública do Google Picker", () => {
    expect(loadGooglePickerConfig({})).toBeNull();
    expect(() =>
      loadGooglePickerConfig({ GOOGLE_PICKER_API_KEY: "key" }),
    ).toThrow("google_picker_configuration_invalid");
    expect(
      loadGooglePickerConfig({
        GOOGLE_PICKER_API_KEY: "key",
        GOOGLE_CLOUD_PROJECT_NUMBER: "123456789",
      }),
    ).toEqual({ apiKey: "key", appId: "123456789" });
  });
});
