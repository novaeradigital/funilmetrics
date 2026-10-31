import { createCipheriv, randomBytes } from "node:crypto";
import type pg from "pg";
import {
  decryptCredentialBundle,
  loadMetaConnectionAccessToken,
} from "./integration-credentials.js";

/**
 * Renovação do token OAuth da Meta (D-145).
 *
 * O token de usuário do OAuth dura cerca de 60 dias. Sem renovação, ele
 * vence em silêncio e toda sincronização passa a falhar com 401. Aqui o
 * worker troca o token por um novo (fb_exchange_token) quando faltam
 * menos de 15 dias para vencer, grava o novo segredo cifrado e atualiza
 * a validade na autorização. Se a Meta responder 401 numa sincronização,
 * a autorização é marcada como expirada: a agenda só cria execuções
 * para autorizações ativas, então a tentativa horária para sozinha e a
 * tela da Meta pede a reconexão.
 */

const graphVersion = "v25.0";
export const metaTokenRefreshThresholdDays = 15;

export function shouldRefreshOAuthToken(
  expiresAt: Date | null,
  now: Date,
  thresholdDays: number = metaTokenRefreshThresholdDays,
): boolean {
  if (!expiresAt) return false;
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= thresholdDays * 86_400_000;
}

function vaultKey(): Buffer | null {
  const encoded = process.env.INTEGRATION_SECRET_ENCRYPTION_KEY?.trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("integration_vault_key_invalid");
  return key;
}

function encryptBundle(value: unknown, key: Buffer) {
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

type MetaAppCredentials = { appId: string; appSecret: string };

async function loadMetaAppCredentials(
  pool: pg.Pool,
  projectId: string,
): Promise<MetaAppCredentials | null> {
  const result = await pool.query<{
    app_id: string;
    ciphertext: Buffer;
    initialization_vector: Buffer;
    authentication_tag: Buffer;
  }>(
    `select connection.configuration->>'appId' as app_id,
            secret.ciphertext,secret.initialization_vector,
            secret.authentication_tag
       from public.connections connection
       join lateral (
         select ciphertext,initialization_vector,authentication_tag
           from public.integration_secrets
          where project_id=connection.project_id
            and provider=connection.provider
            and kind='credential_bundle' and rotated_at is null
          order by created_at desc limit 1
       ) secret on true
      where connection.project_id=$1
        and connection.provider in ('meta_ads_app','meta_ads')
        and connection.configuration->>'appId' is not null
      order by case when connection.provider='meta_ads_app' then 0 else 1 end,
               connection.created_at desc limit 1`,
    [projectId],
  );
  const row = result.rows[0];
  const key = vaultKey();
  if (!row || !key) return null;
  const secret = decryptCredentialBundle(row, key);
  const appSecret = String(secret.appSecret ?? "");
  return row.app_id && appSecret
    ? { appId: row.app_id, appSecret }
    : null;
}

type Authorization = {
  id: string;
  mode: string;
  status: string;
  token_expires_at: Date | null;
};

async function loadAuthorization(
  pool: pg.Pool,
  connectionId: string,
): Promise<Authorization | null> {
  const result = await pool.query<Authorization>(
    `select id, mode::text as mode, status::text as status, token_expires_at
       from public.meta_authorizations
      where connection_id=$1
      order by created_at desc limit 1`,
    [connectionId],
  );
  return result.rows[0] ?? null;
}

export async function refreshMetaOAuthTokenIfNeeded(
  pool: pg.Pool,
  connection: { id: string; projectId: string; organizationId: string },
): Promise<boolean> {
  const authorization = await loadAuthorization(pool, connection.id);
  if (
    !authorization ||
    authorization.mode !== "oauth_user" ||
    authorization.status !== "active"
  ) {
    return false;
  }
  if (!shouldRefreshOAuthToken(authorization.token_expires_at, new Date())) {
    return false;
  }
  const app = await loadMetaAppCredentials(pool, connection.projectId);
  if (!app) return false;
  const currentToken = await loadMetaConnectionAccessToken(pool, connection.id);
  if (!currentToken) return false;
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${graphVersion}/oauth/access_token?${new URLSearchParams(
        {
          grant_type: "fb_exchange_token",
          client_id: app.appId,
          client_secret: app.appSecret,
          fb_exchange_token: currentToken,
        },
      ).toString()}`,
      { cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!payload?.access_token) return false;
  const key = vaultKey();
  if (!key) return false;
  const encrypted = encryptBundle(
    { accessToken: payload.access_token },
    key,
  );
  await pool.query(
    `insert into public.integration_secrets
       (organization_id,project_id,provider,kind,ciphertext,
        initialization_vector,authentication_tag)
     values($1,$2,'meta_ads',$3,$4,$5,$6)`,
    [
      connection.organizationId,
      connection.projectId,
      ["oauth_access_token", connection.id].join(":"),
      encrypted.ciphertext,
      encrypted.initializationVector,
      encrypted.authenticationTag,
    ],
  );
  await pool.query(
    `update public.meta_authorizations
        set token_expires_at=case when $2::int>0
              then now()+($2::text||' seconds')::interval
              else token_expires_at end,
            last_validated_at=now()
      where id=$1`,
    [authorization.id, payload.expires_in ?? 0],
  );
  return true;
}

export async function markMetaAuthorizationExpired(
  pool: pg.Pool,
  connectionId: string,
): Promise<boolean> {
  const result = await pool.query(
    `update public.meta_authorizations
        set status='expired'
      where connection_id=$1 and status='active'`,
    [connectionId],
  );
  return (result.rowCount ?? 0) > 0;
}
