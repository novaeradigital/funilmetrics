import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import {
  buildGoogleAuthorizationUrl,
  createOAuthState,
} from "../../../../../lib/google-drive-oauth";
import { loadProjectGoogleOAuthConfig } from "../../../../../lib/google-drive-runtime";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const requestedProjectId = request.nextUrl.searchParams.get("projectId");
  const active = await getActiveProject(data.user.id);
  if (
    !active.project ||
    !requestedProjectId ||
    requestedProjectId !== active.project.id
  ) {
    return NextResponse.redirect(
      new URL("/dashboard/criativos?status=forbidden", request.url),
    );
  }
  const database = getDatabase();
  const authorization = await database.pool.query<{ project_id: string }>(
    `select project.id as project_id
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
      where app_user.status = 'active'
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=membership.id
            and allowed.project_id=project.id),membership.role)
            in ('owner', 'administrator')
        and project.id = $2
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
    [data.user.id, requestedProjectId],
  );
  const project = authorization.rows[0];
  if (!project) {
    return NextResponse.redirect(
      new URL("/dashboard/criativos?status=forbidden", request.url),
    );
  }
  const config = await loadProjectGoogleOAuthConfig(
    database.pool,
    project.project_id,
  );
  if (!config) {
    return NextResponse.redirect(
      new URL("/dashboard/criativos?status=oauth-not-configured", request.url),
    );
  }
  const nonce = randomBytes(24).toString("base64url");
  const state = createOAuthState(
    { userId: data.user.id, projectId: project.project_id, nonce },
    config.stateSecret,
  );
  const response = NextResponse.redirect(
    buildGoogleAuthorizationUrl(config, state),
  );
  response.cookies.set("fm_google_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}
