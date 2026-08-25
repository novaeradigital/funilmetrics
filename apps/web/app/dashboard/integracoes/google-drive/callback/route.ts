import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import {
  encryptRefreshToken,
  googleDriveScopes,
  peekOAuthStateProjectId,
  verifyOAuthState,
} from "../../../../../lib/google-drive-oauth";
import { loadProjectGoogleOAuthConfig } from "../../../../../lib/google-drive-runtime";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

function finish(request: NextRequest, status: string) {
  const publicOrigin = process.env.APP_URL ?? request.nextUrl.origin;
  const response = NextResponse.redirect(
    new URL(`/dashboard/criativos?status=${status}`, publicOrigin),
  );
  response.cookies.delete("fm_google_oauth_nonce");
  return response;
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("error")) {
    return finish(request, "oauth-denied");
  }
  const code = request.nextUrl.searchParams.get("code");
  const stateValue = request.nextUrl.searchParams.get("state");
  const cookieNonce = request.cookies.get("fm_google_oauth_nonce")?.value;
  if (!code || !stateValue || !cookieNonce) {
    return finish(request, "oauth-invalid");
  }

  const database = getDatabase();
  let state;
  let config;
  try {
    const projectId = peekOAuthStateProjectId(stateValue);
    config = await loadProjectGoogleOAuthConfig(database.pool, projectId);
    if (!config) return finish(request, "oauth-not-configured");
    state = verifyOAuthState(stateValue, config.stateSecret);
  } catch {
    return finish(request, "oauth-invalid");
  }
  if (state.nonce !== cookieNonce) return finish(request, "oauth-invalid");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.id !== state.userId) {
    return finish(request, "oauth-invalid");
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project || active.project.id !== state.projectId) {
    return finish(request, "forbidden");
  }
  const authorization = await database.pool.query<{
    organization_id: string;
    actor_user_id: string;
  }>(
    `select project.organization_id, app_user.id as actor_user_id
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
      where project.id = $2
        and app_user.status = 'active'
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=membership.id
            and allowed.project_id=project.id),membership.role)
            in ('owner', 'administrator')
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = membership.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = membership.id
               and allowed.project_id = project.id
               and coalesce(allowed.role_override, membership.role)
                   in ('owner', 'administrator')
          )
        )
      limit 1`,
    [data.user.id, state.projectId],
  );
  const scope = authorization.rows[0];
  if (!scope) return finish(request, "forbidden");

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return finish(request, "oauth-exchange-unavailable");
  }
  if (!tokenResponse.ok) return finish(request, "oauth-exchange-failed");
  let token: {
    refresh_token?: string;
    id_token?: string;
    scope?: string;
  };
  try {
    token = (await tokenResponse.json()) as typeof token;
  } catch {
    return finish(request, "oauth-exchange-invalid");
  }
  if (
    !token.refresh_token ||
    !token.id_token ||
    !token.scope?.split(" ").includes(googleDriveScopes[2])
  ) {
    return finish(request, "oauth-scope-missing");
  }

  const identityUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  identityUrl.searchParams.set("id_token", token.id_token);
  let identityResponse: Response;
  try {
    identityResponse = await fetch(identityUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return finish(request, "oauth-identity-unavailable");
  }
  if (!identityResponse.ok) return finish(request, "oauth-identity-failed");
  let identity: {
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string;
  };
  try {
    identity = (await identityResponse.json()) as typeof identity;
  } catch {
    return finish(request, "oauth-identity-invalid");
  }
  if (
    identity.aud !== config.clientId ||
    !identity.sub ||
    identity.email_verified !== "true"
  ) {
    return finish(request, "oauth-identity-failed");
  }

  const encrypted = encryptRefreshToken(
    token.refresh_token,
    config.encryptionKey,
  );
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{
      id: string;
      connection_id: string;
      credential_secret_ref: string;
    }>(
      `select id, connection_id, credential_secret_ref
         from public.drive_connections
        where project_id = $1 and google_subject = $2
        limit 1
        for update`,
      [state.projectId, identity.sub],
    );
    const secret = await client.query<{ id: string }>(
      `insert into public.integration_secrets (
         organization_id, project_id, provider, kind, ciphertext,
         initialization_vector, authentication_tag
       ) values ($1, $2, 'google_drive', 'oauth_refresh_token', $3, $4, $5)
       returning id`,
      [
        scope.organization_id,
        state.projectId,
        encrypted.ciphertext,
        encrypted.initializationVector,
        encrypted.authenticationTag,
      ],
    );
    const secretId = secret.rows[0]!.id;
    let driveConnectionId: string;
    if (existing.rows[0]) {
      const current = existing.rows[0];
      driveConnectionId = current.id;
      await client.query(
        `update public.drive_connections
            set account_email = $1, granted_scopes = $2,
                credential_secret_ref = $3, connected_at = now(),
                disconnected_at = null, updated_at = now()
          where id = $4`,
        [identity.email ?? null, token.scope.split(" "), secretId, current.id],
      );
      await client.query(
        `update public.connections
            set status = 'active',
                configuration = configuration ||
                  '{"authorization":"oauth","scope":"drive.readonly"}'::jsonb,
                updated_at = now()
          where id = $1`,
        [current.connection_id],
      );
      await client.query(
        `update public.integration_secrets set rotated_at = now()
          where id = $1`,
        [current.credential_secret_ref],
      );
    } else {
      const connection = await client.query<{ id: string }>(
        `insert into public.connections (
           organization_id, project_id, provider, name, configuration
         ) values ($1, $2, 'google_drive', $3, $4::jsonb)
         returning id`,
        [
          scope.organization_id,
          state.projectId,
          `Google Drive${identity.email ? ` - ${identity.email}` : ""}`,
          JSON.stringify({ authorization: "oauth", scope: "drive.readonly" }),
        ],
      );
      const created = await client.query<{ id: string }>(
        `insert into public.drive_connections (
           organization_id, project_id, connection_id, google_subject,
           account_email, granted_scopes, credential_secret_ref
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          scope.organization_id,
          state.projectId,
          connection.rows[0]!.id,
          identity.sub,
          identity.email ?? null,
          token.scope.split(" "),
          secretId,
        ],
      );
      driveConnectionId = created.rows[0]!.id;
    }
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       ) values ($1, $2, $3, 'drive_connection_created',
                 'drive_connection', $4, $5::jsonb)`,
      [
        scope.organization_id,
        state.projectId,
        scope.actor_user_id,
        driveConnectionId,
        JSON.stringify({
          accountEmail: identity.email ?? null,
          scopes: token.scope.split(" "),
          refreshTokenStoredEncrypted: true,
        }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    return finish(request, "oauth-persistence-failed");
  } finally {
    client.release();
  }
  return finish(request, "drive-connected");
}
