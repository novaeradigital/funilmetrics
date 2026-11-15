import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { signOut } from "../../actions";
import { getDatabase } from "../../../../lib/database";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { setBusinessAssociation } from "../association-actions";

export const dynamic = "force-dynamic";

const providerLabels: Record<string, string> = { lastlink: "Lastlink", configcheckout: "Checkout próprio", chatsx: "ChatSX" };

export default async function UnassignedPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project) redirect("/dashboard/projetos");
  const canManage = ["owner", "administrator", "editor"].includes(project.role);
  const database = getDatabase();
  const returnTo = "/dashboard/projetos/sem-projeto";

  type Item = { id: string; name: string; detail: string };
  const [accounts, connections, products, folders, creatives, businessProjects] = await Promise.all([
    database.pool.query<Item>(`select id, name, '' as detail from public.meta_ad_accounts where project_id = $1 and business_project_id is null order by name`, [project.id]),
    database.pool.query<Item>(`select connection.id, connection.name, connection.provider as detail from public.connections connection where connection.project_id = $1 and connection.business_project_id is null and (connection.provider in ('lastlink','configcheckout','chatsx') or exists(select 1 from public.commerce_orders orders where orders.connection_id = connection.id)) order by connection.provider, connection.name`, [project.id]),
    database.pool.query<Item>(`select product.id, product.name, connection.name as detail from public.commerce_products product join public.connections connection on connection.id = product.connection_id where product.project_id = $1 and product.data_scope = 'production' and coalesce(product.business_project_id, connection.business_project_id) is null order by product.name`, [project.id]),
    database.pool.query<Item>(`select id, name, '' as detail from public.creative_folders where project_id = $1 and business_project_id is null order by name`, [project.id]),
    database.pool.query<Item>(`select creative.id, creative.name, coalesce(folder.name, '') as detail from public.creatives creative left join public.creative_folders folder on folder.id = creative.folder_id where creative.project_id = $1 and coalesce(creative.business_project_id, folder.business_project_id) is null order by creative.name`, [project.id]),
    database.pool.query<{ id: string; name: string }>(`select id, name from public.business_projects where project_id = $1 order by name`, [project.id]),
  ]);

  const section = (title: string, target: string, rows: Item[], detailPrefix = "") => (
    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Sem projeto</p><h2>{title}</h2></div></div>
      {rows.map((item) => <div className="folder-admin-row" key={item.id}>
        <strong>{item.name}</strong>{item.detail ? <span>{detailPrefix}{target === "connection" ? (providerLabels[item.detail] ?? item.detail) : item.detail}</span> : null}
        {canManage ? <form action={setBusinessAssociation} className="inline-filter-form">
          <input name="target" type="hidden" value={target} />
          <input name="target_id" type="hidden" value={item.id} />
          <input name="return_to" type="hidden" value={returnTo} />
          <label>Projeto<select name="business_project_id" required defaultValue="">
            <option value="" disabled>Escolher...</option>
            {businessProjects.rows.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select></label>
          <button type="submit">Associar</button>
        </form> : null}
      </div>)}
      {rows.length === 0 ? <p className="dashboard-context">Nada sem projeto aqui.</p> : null}
    </section>
  );

  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto" />
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project.name}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow"><Link href="/dashboard/projetos">Projetos</Link> · Distribuição</p><h1>Sem projeto</h1><p className="dashboard-context">Estes itens aparecem em Todos os projetos e em nenhum projeto específico. Associe cada um ao projeto certo; também dá para associar pela tela de cada projeto.</p></div></header>
    {query.status === "business-assigned" ? <div className="notice notice-success">Associação salva. Os filtros já valem com a nova divisão.</div> : null}
    {query.status === "business-invalid" ? <div className="notice notice-error">Não foi possível salvar. Revise a seleção e tente de novo.</div> : null}
    {section("Contas de anúncio", "account", accounts.rows)}
    {section("Conexões de pagamento", "connection", connections.rows)}
    {section("Produtos", "product", products.rows, "conexão ")}
    {section("Pastas de criativos", "folder", folders.rows)}
    {section("Criativos", "creative", creatives.rows, "pasta ")}
    </div></section></main>;
}
