import { createDecipheriv, createHmac } from "node:crypto";
import type pg from "pg";
import type { ClamAvConfig } from "./clamav-scanner.js";
import type { R2StorageConfig } from "./r2-storage.js";

type StoredIntegration = {
  provider: string;
  configuration: Record<string, unknown>;
  ciphertext: Buffer | null;
  initialization_vector: Buffer | null;
  authentication_tag: Buffer | null;
};

function vaultKey(environment: NodeJS.ProcessEnv = process.env) {
  const encoded = environment.INTEGRATION_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("integration_vault_key_invalid");
  return key;
}

export function decryptCredentialBundle(
  row: Pick<
    StoredIntegration,
    "ciphertext" | "initialization_vector" | "authentication_tag"
  >,
  key: Buffer,
) {
  if (!row.ciphertext || !row.initialization_vector || !row.authentication_tag) {
    return {};
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    row.initialization_vector,
  );
  decipher.setAuthTag(row.authentication_tag);
  const plaintext = Buffer.concat([
    decipher.update(row.ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

async function storedIntegration(
  pool: pg.Pool,
  projectId: string,
  provider: "cloudflare_r2" | "clamav" | "google_drive_app" | "openai" | "anthropic" | "groq" | "openrouter",
) {
  const result = await pool.query<StoredIntegration>(
    `select connection.provider, connection.configuration,
            secret.ciphertext, secret.initialization_vector,
            secret.authentication_tag
       from public.connections connection
       left join lateral (
         select ciphertext, initialization_vector, authentication_tag
           from public.integration_secrets
          where project_id = connection.project_id
            and provider = connection.provider
            and kind = 'credential_bundle'
            and rotated_at is null
          order by created_at desc limit 1
       ) secret on true
      where connection.project_id = $1
        and connection.provider = $2
        and connection.status = 'active'
      order by connection.created_at desc limit 1`,
    [projectId, provider],
  );
  return result.rows[0] ?? null;
}

export type OpenAIProjectConfig = {
  apiKey: string;
  analysisModel: string;
  transcriptionModel: string;
  monthlyBudgetBrl: number;
  analysisProvider: "openai" | "anthropic" | "openrouter";
  transcriptionProvider: "openai" | "groq" | "openrouter";
};

export async function loadProjectOpenAIConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<OpenAIProjectConfig | null> {
  const stored = await storedIntegration(pool, projectId, "openai");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const apiKey = String(secret.apiKey ?? "").trim();
  const transcriptionModel = String(
    stored.configuration.transcriptionModel ?? "",
  ).trim();
  const analysisModel = String(stored.configuration.analysisModel ?? "").trim();
  const monthlyBudgetBrl = Number(
    stored.configuration.monthlyBudgetBrl ?? 0,
  );
  if (
    !apiKey ||
    !transcriptionModel || !analysisModel ||
    !Number.isFinite(monthlyBudgetBrl) ||
    monthlyBudgetBrl <= 0
  ) {
    throw new Error("openai_configuration_incomplete");
  }
  const analysisRaw =
    String(stored.configuration.analysisProvider ?? "openai").trim();
  const analysisProvider = analysisRaw === "anthropic"
    ? "anthropic" as const
    : analysisRaw === "openrouter"
      ? "openrouter" as const
      : "openai" as const;
  const transcriptionRaw =
    String(stored.configuration.transcriptionProvider ?? "openai").trim();
  const transcriptionProvider = transcriptionRaw === "groq"
    ? "groq" as const
    : transcriptionRaw === "openrouter"
      ? "openrouter" as const
      : "openai" as const;
  return {
    apiKey, analysisModel, transcriptionModel, monthlyBudgetBrl,
    analysisProvider, transcriptionProvider,
  };
}

export type GroqProjectConfig = {
  apiKey: string;
  transcriptionModel: string;
};

export async function loadProjectGroqConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<GroqProjectConfig | null> {
  const stored = await storedIntegration(pool, projectId, "groq");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const apiKey = String(secret.apiKey ?? "").trim();
  const transcriptionModel = String(
    stored.configuration.transcriptionModel ?? "",
  ).trim();
  if (!apiKey || !transcriptionModel) {
    throw new Error("groq_configuration_incomplete");
  }
  return { apiKey, transcriptionModel };
}

export type AnthropicProjectConfig = {
  apiKey: string;
  analysisModel: string;
};

export async function loadProjectAnthropicConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<AnthropicProjectConfig | null> {
  const stored = await storedIntegration(pool, projectId, "anthropic");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const apiKey = String(secret.apiKey ?? "").trim();
  const analysisModel = String(stored.configuration.analysisModel ?? "").trim();
  if (!apiKey || !analysisModel) {
    throw new Error("anthropic_configuration_incomplete");
  }
  return { apiKey, analysisModel };
}

export type OpenRouterProjectConfig = {
  apiKey: string;
  analysisModel: string;
  transcriptionModel: string;
};

export async function loadProjectOpenRouterConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<OpenRouterProjectConfig | null> {
  const stored = await storedIntegration(pool, projectId, "openrouter");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const apiKey = String(secret.apiKey ?? "").trim();
  const analysisModel = String(stored.configuration.analysisModel ?? "").trim();
  const transcriptionModel = String(
    stored.configuration.transcriptionModel ?? "",
  ).trim();
  if (!apiKey || !analysisModel || !transcriptionModel) {
    throw new Error("openrouter_configuration_incomplete");
  }
  return { apiKey, analysisModel, transcriptionModel };
}

export type GoogleDriveAppConfig = {
  clientId: string;
  clientSecret: string;
  refreshTokenEncryptionKey: Buffer;
};

export async function loadProjectGoogleDriveAppConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<GoogleDriveAppConfig | null> {
  const stored = await storedIntegration(pool, projectId, "google_drive_app");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const clientId = String(secret.clientId ?? "").trim();
  const clientSecret = String(secret.clientSecret ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("google_oauth_configuration_incomplete");
  }
  return {
    clientId,
    clientSecret,
    refreshTokenEncryptionKey: createHmac("sha256", key)
      .update("funil-metrics:google-refresh-token:v1")
      .digest(),
  };
}

export async function loadProjectR2Config(
  pool: pg.Pool,
  projectId: string,
): Promise<R2StorageConfig | null> {
  const stored = await storedIntegration(pool, projectId, "cloudflare_r2");
  if (!stored) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(stored, key);
  const accountId = String(stored.configuration.accountId ?? "").trim();
  const endpoint = String(stored.configuration.endpoint ?? "").trim();
  const bucket = String(stored.configuration.bucket ?? "").trim();
  const accessKeyId = String(secret.accessKeyId ?? "").trim();
  const secretAccessKey = String(secret.secretAccessKey ?? "").trim();
  if ((!accountId && !endpoint) || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("r2_configuration_incomplete");
  }
  return {
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export async function loadProjectClamAvConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<ClamAvConfig | null> {
  const stored = await storedIntegration(pool, projectId, "clamav");
  if (!stored) return null;
  const host = String(stored.configuration.host ?? "").trim();
  const port = Number(stored.configuration.port ?? 3310);
  if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("clamav_configuration_invalid");
  }
  return {
    host,
    port,
    timeoutMs: 120_000,
    maxBytes: 2 * 1024 ** 3,
  };
}

export async function loadMetaConnectionAccessToken(
  pool:pg.Pool,
  connectionId:string,
):Promise<string|null>{
  const result=await pool.query<StoredIntegration>(
    `select connection.provider,connection.configuration,
            secret.ciphertext,secret.initialization_vector,
            secret.authentication_tag
       from public.connections connection
       join public.integration_secrets secret
         on secret.project_id=connection.project_id
        and secret.provider='meta_ads' and secret.rotated_at is null
        and (secret.kind='oauth_access_token:'||connection.id::text
          or (secret.kind='credential_bundle' and
              coalesce(connection.configuration->>'authorizationMode',
                       'system_user')='system_user'))
      where connection.id=$1 and connection.provider='meta_ads'
        and connection.status='active'
      order by secret.created_at desc limit 1`,
    [connectionId],
  );
  const row=result.rows[0];
  if(!row)return null;
  const key=vaultKey();
  if(!key)throw new Error("integration_vault_disabled");
  const secret=decryptCredentialBundle(row,key);
  const token=String(secret.accessToken??"").trim();
  return token||null;
}

export async function loadMetaCapiToken(
  pool: pg.Pool,
  projectId: string,
  businessProjectId: string,
): Promise<string | null> {
  const result = await pool.query<Pick<
    StoredIntegration,
    "ciphertext" | "initialization_vector" | "authentication_tag"
  >>(
    `select ciphertext, initialization_vector, authentication_tag
       from public.integration_secrets
      where project_id = $1
        and provider = 'meta_capi'
        and kind = 'capi_token:' || $2
        and rotated_at is null
      order by created_at desc limit 1`,
    [projectId, businessProjectId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const key = vaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptCredentialBundle(row, key);
  const token = String(secret.accessToken ?? "").trim();
  return token || null;
}
