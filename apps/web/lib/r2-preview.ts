import "server-only";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type pg from "pg";
import {
  decryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "./integration-vault";

export function loadR2PreviewConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const accountId = environment.R2_ACCOUNT_ID?.trim();
  const endpoint = environment.R2_ENDPOINT?.trim();
  const accessKeyId = environment.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = environment.R2_BUCKET?.trim();
  const supplied = [accountId, endpoint, accessKeyId, secretAccessKey, bucket]
    .filter(Boolean).length;
  if (supplied === 0) return null;
  if (
    (!accountId && !endpoint) ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucket
  ) {
    throw new Error("r2_preview_configuration_incomplete");
  }
  return {
    endpoint:
      endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

export function createR2PreviewClient(
  config: NonNullable<ReturnType<typeof loadR2PreviewConfig>>,
) {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function loadProjectR2PreviewConfig(
  pool: pg.Pool,
  projectId: string,
) {
  const result = await pool.query<{
    configuration: Record<string, unknown>;
    ciphertext: Buffer;
    initialization_vector: Buffer;
    authentication_tag: Buffer;
  }>(
    `select connection.configuration, secret.ciphertext,
            secret.initialization_vector, secret.authentication_tag
       from public.connections connection
       join lateral (
         select ciphertext, initialization_vector, authentication_tag
           from public.integration_secrets
          where project_id = connection.project_id
            and provider = connection.provider
            and kind = 'credential_bundle'
            and rotated_at is null
          order by created_at desc limit 1
       ) secret on true
      where connection.project_id = $1
        and connection.provider = 'cloudflare_r2'
        and connection.status = 'active'
      order by connection.created_at desc limit 1`,
    [projectId],
  );
  const stored = result.rows[0];
  if (!stored) return loadR2PreviewConfig();
  const key = loadIntegrationVaultKey();
  if (!key) throw new Error("integration_vault_disabled");
  const secret = decryptIntegrationSecret(
    {
      ciphertext: stored.ciphertext,
      initializationVector: stored.initialization_vector,
      authenticationTag: stored.authentication_tag,
    },
    key,
  );
  const accountId = String(stored.configuration.accountId ?? "").trim();
  const endpoint = String(stored.configuration.endpoint ?? "").trim();
  const bucket = String(stored.configuration.bucket ?? "").trim();
  const accessKeyId = String(secret.accessKeyId ?? "").trim();
  const secretAccessKey = String(secret.secretAccessKey ?? "").trim();
  if ((!accountId && !endpoint) || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("r2_preview_configuration_incomplete");
  }
  return {
    endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
    bucket,
  };
}

export async function getPrivateCreativeObject(input: {
  key: string;
  range?: string;
  config?: NonNullable<ReturnType<typeof loadR2PreviewConfig>>;
}) {
  const config = input.config ?? loadR2PreviewConfig();
  if (!config) throw new Error("r2_preview_not_configured");
  if (!input.key.startsWith("assets-private/")) {
    throw new Error("private_asset_key_invalid");
  }
  const client = createR2PreviewClient(config);
  try {
    return await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Range: input.range,
      }),
    );
  } finally {
    client.destroy();
  }
}

export async function getPrivateCreativeSignedUrl(input: {
  key: string;
  config: NonNullable<ReturnType<typeof loadR2PreviewConfig>>;
  expiresIn?: number;
}) {
  if (!input.key.startsWith("assets-private/")) {
    throw new Error("private_asset_key_invalid");
  }
  const expiresIn = input.expiresIn ?? 5 * 60;
  if (!Number.isSafeInteger(expiresIn) || expiresIn < 30 || expiresIn > 15 * 60) {
    throw new Error("private_asset_expiry_invalid");
  }
  const client = createR2PreviewClient(input.config);
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: input.config.bucket,
        Key: input.key,
      }),
      { expiresIn },
    );
  } finally {
    client.destroy();
  }
}
