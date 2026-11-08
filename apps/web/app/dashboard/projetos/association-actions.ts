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

function backTo(returnTo: string, status: string): never {
  const safe = returnTo.startsWith("/dashboard/projetos") ? returnTo : "/dashboard/projetos";
  revalidatePath("/dashboard/projetos");
  redirect(`${safe}?status=${status}`);
}

const targetTables = {
  account: "public.meta_ad_accounts",
  connection: "public.connections",
  product: "public.commerce_products",
  folder: "public.creative_folders",
  creative: "public.creatives",
} as const;

/**
 * Associa (ou desassocia, com business_project_id vazio) um item a um
 * projeto de negócio, voltando para a tela de origem (a tela do projeto
 * ou a distribuição do Sem projeto). A associação é exclusiva: o item
 * guarda um único projeto.
 */
export async function setBusinessAssociation(data: FormData) {
  const scope = await requireManager();
  const returnTo = field(data, "return_to", 200) || "/dashboard/projetos";
  const target = field(data, "target", 20) as keyof typeof targetTables;
  const targetId = field(data, "target_id", 64);
  const businessId = field(data, "business_project_id", 64);
  const table = targetTables[target];
  if (!table || !uuidPattern.test(targetId) || (businessId && !uuidPattern.test(businessId)))
    backTo(returnTo, "business-invalid");
  const database = getDatabase();
  if (businessId) {
    const exists = await database.pool.query(
      `select id from public.business_projects where id = $1 and project_id = $2 limit 1`,
      [businessId, scope.projectId],
    );
    if (!exists.rows[0]) backTo(returnTo, "business-invalid");
  }
  await database.pool.query(
    `update ${table} set business_project_id = $1, updated_at = now()
      where id = $2 and project_id = $3`,
    [businessId || null, targetId, scope.projectId],
  );
  backTo(returnTo, "business-assigned");
}

/** Move criativos em massa entre pastas do projeto, ou para fora de pasta. */
export async function moveCreativesToFolder(data: FormData) {
  const scope = await requireManager();
  const returnTo = field(data, "return_to", 200) || "/dashboard/projetos";
  const folderId = field(data, "folder_id", 64);
  const creativeIds = data.getAll("creative_id")
    .map((value) => String(value).trim())
    .filter((value) => uuidPattern.test(value))
    .slice(0, 200);
  if ((folderId && !uuidPattern.test(folderId)) || creativeIds.length === 0)
    backTo(returnTo, "business-invalid");
  const database = getDatabase();
  if (folderId) {
    const folder = await database.pool.query(
      `select id from public.creative_folders where id = $1 and project_id = $2 limit 1`,
      [folderId, scope.projectId],
    );
    if (!folder.rows[0]) backTo(returnTo, "business-invalid");
  }
  await database.pool.query(
    `update public.creatives set folder_id = $1, updated_at = now()
      where id = any($2::uuid[]) and project_id = $3`,
    [folderId || null, creativeIds, scope.projectId],
  );
  backTo(returnTo, "business-assigned");
}
