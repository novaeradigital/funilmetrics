import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptCredentialBundle,
  loadProjectGoogleDriveAppConfig,
  loadMetaConnectionAccessToken,
} from "./integration-credentials.js";

describe("integration credential vault", () => {
  it("decifra o bundle AES-256-GCM salvo pelo painel", () => {
    const key = randomBytes(32);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ accessKeyId: "safe-id" }), "utf8"),
      cipher.final(),
    ]);
    expect(
      decryptCredentialBundle(
        {
          ciphertext,
          initialization_vector: initializationVector,
          authentication_tag: cipher.getAuthTag(),
        },
        key,
      ),
    ).toEqual({ accessKeyId: "safe-id" });
  });

  it("carrega OAuth do Drive e deriva a mesma chave usada pelo painel", async () => {
    const key = randomBytes(32);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
    const ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify({ clientId: "client", clientSecret: "secret" }),
        "utf8",
      ),
      cipher.final(),
    ]);
    const pool = {
      query: async () => ({
        rows: [
          {
            provider: "google_drive_app",
            configuration: {},
            ciphertext,
            initialization_vector: initializationVector,
            authentication_tag: cipher.getAuthTag(),
          },
        ],
      }),
    };
    const previous = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
    process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = key.toString("base64");
    try {
      const config = await loadProjectGoogleDriveAppConfig(
        pool as never,
        "project",
      );
      expect(config?.clientId).toBe("client");
      expect(config?.clientSecret).toBe("secret");
      expect(config?.refreshTokenEncryptionKey).toEqual(
        createHmac("sha256", key)
          .update("funil-metrics:google-refresh-token:v1")
          .digest(),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
      } else {
        process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = previous;
      }
    }
  });

  it("carrega token Meta cifrado da conexão específica",async()=>{
    const key=randomBytes(32),initializationVector=randomBytes(12);
    const cipher=createCipheriv("aes-256-gcm",key,initializationVector);
    const ciphertext=Buffer.concat([
      cipher.update(JSON.stringify({accessToken:"meta-token"}),"utf8"),
      cipher.final(),
    ]);
    const pool={query:async()=>({rows:[{
      provider:"meta_ads",configuration:{},ciphertext,
      initialization_vector:initializationVector,
      authentication_tag:cipher.getAuthTag(),
    }]})};
    const previous=process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
    process.env.INTEGRATION_SECRET_ENCRYPTION_KEY=key.toString("base64");
    try{
      await expect(loadMetaConnectionAccessToken(pool as never,"connection"))
        .resolves.toBe("meta-token");
    }finally{
      if(previous===undefined)delete process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
      else process.env.INTEGRATION_SECRET_ENCRYPTION_KEY=previous;
    }
  });
});
