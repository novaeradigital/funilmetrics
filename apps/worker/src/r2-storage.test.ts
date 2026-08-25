import {
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  loadR2StorageConfig,
  privateAssetObjectKey,
  quarantineObjectKey,
  R2CreativeStorage,
} from "./r2-storage.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const importJobId = "33333333-3333-4333-8333-333333333333";
const importItemId = "44444444-4444-4444-8444-444444444444";
const contentSha256 = "a".repeat(64);
const config = {
  endpoint: "https://account.r2.cloudflarestorage.com",
  accessKeyId: "access",
  secretAccessKey: "secret",
  bucket: "creative-private",
};

describe("R2CreativeStorage", () => {
  it("permanece desativado sem configuração e rejeita configuração parcial", () => {
    expect(loadR2StorageConfig({})).toBeNull();
    expect(() => loadR2StorageConfig({ R2_BUCKET: "bucket" })).toThrow(
      "r2_configuration_incomplete",
    );
  });

  it("gera chaves determinísticas e isoladas por escopo", () => {
    expect(
      quarantineObjectKey({
        organizationId,
        projectId,
        importJobId,
        importItemId,
      }),
    ).toBe(
      `quarantine/${organizationId}/${projectId}/${importJobId}/${importItemId}`,
    );
    expect(
      privateAssetObjectKey(organizationId, projectId, contentSha256),
    ).toBe(`assets-private/${organizationId}/${projectId}/${contentSha256}`);
  });

  it("envia primeiro para quarentena sem tornar o arquivo disponível", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new R2CreativeStorage(config, { send });
    await storage.putInQuarantine({
      organizationId,
      projectId,
      importJobId,
      importItemId,
      body: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      sizeBytes: 3,
    });
    expect(send).toHaveBeenCalledOnce();
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Key).toContain("quarantine/");
    expect(command.input.Metadata?.availability).toBe("quarantined");
  });

  it("promove apenas resultado limpo e remove a cópia de quarentena depois", async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new R2CreativeStorage(config, { send });
    const quarantineKey = quarantineObjectKey({
      organizationId,
      projectId,
      importJobId,
      importItemId,
    });
    await storage.promoteCleanObject({
      quarantineKey,
      organizationId,
      projectId,
      contentSha256,
      scanStatus: "clean",
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(CopyObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });
});
