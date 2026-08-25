import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import {
  getPrivateCreativeSignedUrl,
  loadProjectR2PreviewConfig,
} from "../../../../../lib/r2-preview";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const active = await getActiveProject(data.user.id);
  if (!active.project) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const database = getDatabase();
  const result = await database.pool.query<{
    object_key: string;
    mime_type: string;
    size_bytes: string;
    project_id: string;
  }>(
    `select asset.object_key, asset.mime_type, asset.size_bytes::text,
            asset.project_id
       from public.creative_assets asset
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = asset.organization_id
        and membership.user_id = app_user.id
      where asset.id = $2
        and asset.project_id = $3
        and asset.available_at is not null
        and asset.malware_status = 'clean'
        and app_user.status = 'active'
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = membership.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = membership.id
               and allowed.project_id = asset.project_id
          )
        )
      limit 1`,
    [data.user.id, id, active.project.id],
  );
  const asset = result.rows[0];
  if (!asset) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const config = await loadProjectR2PreviewConfig(
      database.pool,
      asset.project_id,
    );
    if (!config) throw new Error("r2_preview_not_configured");
    const signedUrl = await getPrivateCreativeSignedUrl({
      key: asset.object_key,
      config,
      expiresIn: 5 * 60,
    });
    const response = NextResponse.redirect(signedUrl, 307);
    response.headers.set(
      "cache-control",
      "private, no-store, max-age=0",
    );
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch {
    return NextResponse.json(
      { error: "preview_unavailable" },
      { status: 503 },
    );
  }
}
