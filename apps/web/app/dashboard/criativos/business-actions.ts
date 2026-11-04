"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";

const uuidPattern = /^[0-9a-f-]{36}$/i;

async function resolveEditorScope(projectId: string) {
  if (!uuidPattern.test(projectId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const database = getDatabase();
  const scope = await database.pool.query<{ organization_id: string; actor_user_id: string }>(
    `select project.organization_id, app_user.id as actor_user_id
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
      where project.id = $2 and app_user.status = 'active'
        and membership.role in ('owner', 'administrator', 'editor')
      limit 1`,
    [data.user.id, projectId],
  );
  const row = scope.rows[0];
  return row ? { database, organizationId: row.organization_id, actorUserId: row.actor_user_id } : null;
}

function backToLibrary(status: string): never {
  revalidatePath("/dashboard/criativos");
  redirect(`/dashboard/criativos?status=${status}`);
}

export async function moveCreativeToBusiness(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const creativeId = String(formData.get("creative_id") ?? "");
  const businessId = String(formData.get("business_project_id") ?? "");
  const scope = await resolveEditorScope(projectId);
  if (!scope || !uuidPattern.test(creativeId)) backToLibrary("forbidden");
  if (businessId && !uuidPattern.test(businessId)) backToLibrary("business-invalid");
  if (businessId) {
    const found = await scope.database.pool.query(
      `select id from public.business_projects where id = $1 and project_id = $2 limit 1`,
      [businessId, projectId],
    );
    if (!found.rows[0]) backToLibrary("business-invalid");
  }
  await scope.database.pool.query(
    `update public.creatives set business_project_id = $1, updated_at = now()
      where id = $2 and project_id = $3`,
    [businessId || null, creativeId, projectId],
  );
  backToLibrary("creative-business");
}
