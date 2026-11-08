"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveProject } from "../../../lib/active-project";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";

const uuidPattern = /^[0-9a-f-]{36}$/i;

function field(data: FormData, name: string, max = 120): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireManager() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project || !["owner", "administrator", "editor"].includes(project.role))
    redirect("/dashboard/projetos?status=forbidden");
  return { projectId: project.id, organizationId: project.organization_id };
}

function back(status: string): never {
  revalidatePath("/dashboard/projetos");
  redirect(`/dashboard/projetos?status=${status}`);
}

export async function createBusinessProject(data: FormData) {
  const scope = await requireManager();
  const name = field(data, "name", 80).replace(/\s+/g, " ");
  if (name.length < 2) back("business-invalid");
  try {
    await getDatabase().pool.query(
      `insert into public.business_projects (organization_id, project_id, name)
       values ($1, $2, $3)`,
      [scope.organizationId, scope.projectId, name],
    );
  } catch {
    back("business-duplicate");
  }
  back("business-created");
}

export async function renameBusinessProject(data: FormData) {
  const scope = await requireManager();
  const id = field(data, "business_id", 64);
  const name = field(data, "name", 80).replace(/\s+/g, " ");
  if (!uuidPattern.test(id) || name.length < 2) back("business-invalid");
  try {
    await getDatabase().pool.query(
      `update public.business_projects set name = $1, updated_at = now()
        where id = $2 and project_id = $3`,
      [name, id, scope.projectId],
    );
  } catch {
    back("business-duplicate");
  }
  back("business-renamed");
}

export async function deleteBusinessProject(data: FormData) {
  const scope = await requireManager();
  const id = field(data, "business_id", 64);
  if (!uuidPattern.test(id)) back("business-invalid");
  await getDatabase().pool.query(
    `delete from public.business_projects where id = $1 and project_id = $2`,
    [id, scope.projectId],
  );
  back("business-deleted");
}

const targetTables = {
  account: "public.meta_ad_accounts",
  connection: "public.connections",
  product: "public.commerce_products",
  creative: "public.creatives",
  folder: "public.creative_folders",
} as const;

export async function assignBusinessProject(data: FormData) {
  const scope = await requireManager();
  const target = field(data, "target", 20) as keyof typeof targetTables;
  const targetId = field(data, "target_id", 64);
  const businessId = field(data, "business_project_id", 64);
  const table = targetTables[target];
  if (!table || !uuidPattern.test(targetId) || (businessId && !uuidPattern.test(businessId)))
    back("business-invalid");
  const database = getDatabase();
  if (businessId) {
    const exists = await database.pool.query(
      `select id from public.business_projects where id = $1 and project_id = $2 limit 1`,
      [businessId, scope.projectId],
    );
    if (!exists.rows[0]) back("business-invalid");
  }
  await database.pool.query(
    `update ${table} set business_project_id = $1, updated_at = now()
      where id = $2 and project_id = $3`,
    [businessId || null, targetId, scope.projectId],
  );
  back("business-assigned");
}
