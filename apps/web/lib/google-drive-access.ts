import "server-only";
import { getDatabase } from "./database";
import {
  decryptRefreshToken,
} from "./google-drive-oauth";
import { loadProjectGoogleOAuthConfig } from "./google-drive-runtime";

export type AuthorizedDriveConnection = {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  driveConnectionId: string;
  accountEmail: string | null;
};

export async function getAuthorizedDriveConnection(input: {
  authUserId: string;
  projectId: string;
}) {
  const database = getDatabase();
  const result = await database.pool.query<
    AuthorizedDriveConnection & {
      ciphertext: Buffer;
      initializationVector: Buffer;
      authenticationTag: Buffer;
    }
  >(
    `select project.organization_id as "organizationId",
            project.id as "projectId",
            app_user.id as "actorUserId",
            drive.id as "driveConnectionId",
            drive.account_email as "accountEmail",
            secret.ciphertext,
            secret.initialization_vector as "initializationVector",
            secret.authentication_tag as "authenticationTag"
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
       join public.drive_connections drive
         on drive.project_id = project.id
        and drive.organization_id = project.organization_id
        and drive.disconnected_at is null
       join public.integration_secrets secret
         on secret.id = drive.credential_secret_ref
        and secret.organization_id = drive.organization_id
        and secret.project_id = drive.project_id
        and secret.rotated_at is null
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
      order by drive.updated_at desc
      limit 1`,
    [input.authUserId, input.projectId],
  );
  const connection = result.rows[0];
  if (!connection) return null;
  const config = await loadProjectGoogleOAuthConfig(
    database.pool,
    input.projectId,
  );
  if (!config) throw new Error("google_oauth_not_configured");
  const refreshToken = decryptRefreshToken(
    {
      ciphertext: connection.ciphertext,
      initializationVector: connection.initializationVector,
      authenticationTag: connection.authenticationTag,
    },
    config.encryptionKey,
  );
  return { connection, config, refreshToken };
}

export async function exchangeGoogleRefreshToken(
  config: NonNullable<Awaited<ReturnType<typeof loadProjectGoogleOAuthConfig>>>,
  refreshToken: string,
) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("google_refresh_failed");
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };
  if (!body.access_token || body.token_type?.toLowerCase() !== "bearer") {
    throw new Error("google_refresh_invalid");
  }
  return {
    accessToken: body.access_token,
    expiresIn: Math.min(Math.max(body.expires_in ?? 300, 60), 3600),
  };
}
