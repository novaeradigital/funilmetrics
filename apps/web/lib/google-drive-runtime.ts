import "server-only";
import { createHmac } from "node:crypto";
import type pg from "pg";
import {
  decryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "./integration-vault";
import {
  loadGoogleOAuthConfig,
  loadGooglePickerConfig,
  type GoogleOAuthConfig,
} from "./google-drive-oauth";

type StoredGoogleApp = {
  configuration: Record<string, unknown>;
  ciphertext: Buffer;
  initialization_vector: Buffer;
  authentication_tag: Buffer;
};

async function storedGoogleApp(pool: pg.Pool, projectId: string) {
  const result = await pool.query<StoredGoogleApp>(
    `select connection.configuration, secret.ciphertext,
            secret.initialization_vector, secret.authentication_tag
       from public.connections connection
       join lateral (
         select ciphertext, initialization_vector, authentication_tag
           from public.integration_secrets
          where project_id = connection.project_id
            and provider = 'google_drive_app'
            and kind = 'credential_bundle' and rotated_at is null
          order by created_at desc limit 1
       ) secret on true
      where connection.project_id = $1
        and connection.provider = 'google_drive_app'
        and connection.status = 'active'
      order by connection.created_at desc limit 1`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

function derivedKey(master: Buffer, purpose: string) {
  return createHmac("sha256", master)
    .update(`funil-metrics:${purpose}:v1`)
    .digest();
}

function decryptedBundle(stored: StoredGoogleApp) {
  const master = loadIntegrationVaultKey();
  if (!master) throw new Error("integration_vault_disabled");
  return {
    master,
    secret: decryptIntegrationSecret(
      {
        ciphertext: stored.ciphertext,
        initializationVector: stored.initialization_vector,
        authenticationTag: stored.authentication_tag,
      },
      master,
    ),
  };
}

export async function loadProjectGoogleOAuthConfig(
  pool: pg.Pool,
  projectId: string,
): Promise<GoogleOAuthConfig | null> {
  const stored = await storedGoogleApp(pool, projectId);
  if (!stored) return loadGoogleOAuthConfig();
  const { master, secret } = decryptedBundle(stored);
  const clientId = String(secret.clientId ?? "").trim();
  const clientSecret = String(secret.clientSecret ?? "").trim();
  const redirectUri = String(stored.configuration.redirectUri ?? "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("google_oauth_configuration_incomplete");
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    stateSecret: derivedKey(master, "google-oauth-state").toString("base64url"),
    encryptionKey: derivedKey(master, "google-refresh-token"),
  };
}

export async function loadProjectGooglePickerConfig(
  pool: pg.Pool,
  projectId: string,
) {
  const stored = await storedGoogleApp(pool, projectId);
  if (!stored) return loadGooglePickerConfig();
  const { secret } = decryptedBundle(stored);
  const apiKey = String(secret.pickerApiKey ?? "").trim();
  const appId = String(stored.configuration.projectNumber ?? "").trim();
  if (!apiKey || !/^\d+$/.test(appId)) {
    throw new Error("google_picker_configuration_invalid");
  }
  return { apiKey, appId };
}
