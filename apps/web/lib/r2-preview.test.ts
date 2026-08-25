import { describe, expect, it, vi } from "vitest";
import {
  getPrivateCreativeSignedUrl,
  loadR2PreviewConfig,
} from "./r2-preview.js";

vi.mock("server-only", () => ({}));

describe("R2 private preview", () => {
  it("fica desabilitado sem configuração e rejeita configuração parcial", () => {
    expect(loadR2PreviewConfig({})).toBeNull();
    expect(() => loadR2PreviewConfig({ R2_BUCKET: "bucket" })).toThrow(
      "r2_preview_configuration_incomplete",
    );
  });

  it("deriva endpoint privado pelo account id", () => {
    expect(
      loadR2PreviewConfig({
        R2_ACCOUNT_ID: "account",
        R2_ACCESS_KEY_ID: "access",
        R2_SECRET_ACCESS_KEY: "secret",
        R2_BUCKET: "bucket",
      }),
    ).toEqual({
      endpoint: "https://account.r2.cloudflarestorage.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "bucket",
    });
  });

  it("assina somente ativos privados por uma janela curta", async () => {
    const config = {
      endpoint: "https://account.r2.cloudflarestorage.com",
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "bucket",
    };
    const signed = new URL(
      await getPrivateCreativeSignedUrl({
        key: "assets-private/project/video.mp4",
        config,
        expiresIn: 300,
      }),
    );
    expect(signed.pathname).toContain(
      "/bucket/assets-private/project/video.mp4",
    );
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(signed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    await expect(
      getPrivateCreativeSignedUrl({
        key: "quarantine/project/video.mp4",
        config,
      }),
    ).rejects.toThrow("private_asset_key_invalid");
  });
});
