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

export async function createCreativeFolder(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const scope = await resolveEditorScope(projectId);
  if (!scope) backToLibrary("forbidden");
  if (!name) backToLibrary("folder-invalid");
  try {
    await scope.database.pool.query(
      `insert into public.creative_folders (organization_id, project_id, name, created_by_user_id)
       values ($1, $2, $3, $4)`,
      [scope.organizationId, projectId, name, scope.actorUserId],
    );
  } catch {
    backToLibrary("folder-duplicate");
  }
  backToLibrary("folder-created");
}

export async function renameCreativeFolder(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const folderId = String(formData.get("folder_id") ?? "");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const scope = await resolveEditorScope(projectId);
  if (!scope || !uuidPattern.test(folderId)) backToLibrary("forbidden");
  if (!name) backToLibrary("folder-invalid");
  try {
    await scope.database.pool.query(
      `update public.creative_folders set name = $1, updated_at = now()
        where id = $2 and project_id = $3`,
      [name, folderId, projectId],
    );
  } catch {
    backToLibrary("folder-duplicate");
  }
  backToLibrary("folder-renamed");
}

export async function deleteCreativeFolder(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const folderId = String(formData.get("folder_id") ?? "");
  const scope = await resolveEditorScope(projectId);
  if (!scope || !uuidPattern.test(folderId)) backToLibrary("forbidden");
  await scope.database.pool.query(
    `delete from public.creative_folders where id = $1 and project_id = $2`,
    [folderId, projectId],
  );
  backToLibrary("folder-deleted");
}

export async function moveCreativeToFolder(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const creativeId = String(formData.get("creative_id") ?? "");
  const folderId = String(formData.get("folder_id") ?? "");
  const scope = await resolveEditorScope(projectId);
  if (!scope || !uuidPattern.test(creativeId)) backToLibrary("forbidden");
  if (folderId && !uuidPattern.test(folderId)) backToLibrary("folder-invalid");
  if (folderId) {
    const folder = await scope.database.pool.query(
      `select id from public.creative_folders where id = $1 and project_id = $2 limit 1`,
      [folderId, projectId],
    );
    if (!folder.rows[0]) backToLibrary("folder-invalid");
  }
  await scope.database.pool.query(
    `update public.creatives set folder_id = $1, updated_at = now()
      where id = $2 and project_id = $3`,
    [folderId || null, creativeId, projectId],
  );
  backToLibrary("creative-moved");
}
