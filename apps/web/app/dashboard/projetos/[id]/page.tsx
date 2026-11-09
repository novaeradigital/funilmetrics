import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { signOut } from "../../actions";
import { getDatabase } from "../../../../lib/database";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { addCreativesToBusinessProject, moveCreativesToFolder, removeCreativeFromBusinessProject, setBusinessAssociation } from "../association-actions";
import { AssociationPicker, type PickerGroup } from "../association-picker";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f-]{36}$/i;
const providerLabels: Record<string, string> = { lastlink: "Lastlink", configcheckout: "Checkout próprio" };

export default async function BusinessProjectPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project) redirect("/dashboard/projetos");
  if (!uuidPattern.test(id)) redirect("/dashboard/projetos");
  const canManage = ["owner", "administrator", "editor"].includes(project.role);
  const database = getDatabase();
  const business = (await database.pool.query<{ id: string; name: string }>(
    `select id, name from public.business_projects where id = $1 and project_id = $2`,
    [id, project.id],
  )).rows[0];
  if (!business) redirect("/dashboard/projetos");
  const returnTo = `/dashboard/projetos/${business.id}`;

  type Account = { id: string; name: string; business_project_id: string | null };
  type Connection = { id: string; provider: string; name: string; business_project_id: string | null };
  type Product = { id: string; name: string; connection_name: string; override_id: string | null; effective_id: string | null };
  type Folder = { id: string; name: string; business_project_id: string | null; creatives: number };
  type Creative = { id: string; name: string; folder_name: string | null; own_id: string | null; effective_id: string | null };
  const [accounts, connections, products, folders, creatives, businessProjects] = await Promise.all([
    database.pool.query<Account>(`select id, name, business_project_id::text as business_project_id from public.meta_ad_accounts where project_id = $1 order by name`, [project.id]),
    database.pool.query<Connection>(`select connection.id, connection.provider, connection.name, connection.business_project_id::text as business_project_id from public.connections connection where connection.project_id = $1 and (connection.provider in ('lastlink','configcheckout') or exists(select 1 from public.commerce_orders orders where orders.connection_id = connection.id)) order by connection.provider, connection.name`, [project.id]),
    database.pool.query<Product>(`select product.id, product.name, connection.name as connection_name, product.business_project_id::text as override_id, coalesce(product.business_project_id, connection.business_project_id)::text as effective_id from public.commerce_products product join public.connections connection on connection.id = product.connection_id where product.project_id = $1 and product.data_scope = 'production' order by product.name`, [project.id]),
    database.pool.query<Folder>(`select folder.id, folder.name, folder.business_project_id::text as business_project_id, (select count(*)::int from public.creatives creative where creative.folder_id = folder.id) as creatives from public.creative_folders folder where folder.project_id = $1 order by folder.name`, [project.id]),
    database.pool.query<Creative>(`select creative.id, creative.name, folder.name as folder_name, creative.business_project_id::text as own_id, coalesce(creative.business_project_id, folder.business_project_id)::text as effective_id from public.creatives creative left join public.creative_folders folder on folder.id = creative.folder_id where creative.project_id = $1 order by creative.name`, [project.id]),
    database.pool.query<{ id: string; name: string }>(`select id, name from public.business_projects where project_id = $1 order by name`, [project.id]),
  ]);
  const nameById = new Map(businessProjects.rows.map((item) => [item.id, item.name]));
  const mine = {
    accounts: accounts.rows.filter((row) => row.business_project_id === business.id),
    connections: connections.rows.filter((row) => row.business_project_id === business.id),
    products: products.rows.filter((row) => row.effective_id === business.id),
    folders: folders.rows.filter((row) => row.business_project_id === business.id),
    creatives: creatives.rows.filter((row) => row.effective_id === business.id),
  };
  const others = {
    accounts: accounts.rows.filter((row) => row.business_project_id !== business.id),
    connections: connections.rows.filter((row) => row.business_project_id !== business.id),
    products: products.rows.filter((row) => row.effective_id !== business.id),
    folders: folders.rows.filter((row) => row.business_project_id !== business.id),
  };
  const projectFolders = mine.folders;

  function groupsFor<T extends { id: string; name: string }>(
    rows: T[],
    bizOf: (row: T) => string | null,
    detailOf?: (row: T) => string | undefined,
  ): PickerGroup[] {
    const free = rows.filter((row) => bizOf(row) === null);
    const taken = rows.filter((row) => bizOf(row) !== null);
    const groups: PickerGroup[] = [];
    if (free.length) groups.push({ title: "Sem projeto", items: free.map((row) => ({ id: row.id, name: row.name, detail: detailOf?.(row) })) });
    if (taken.length) groups.push({ title: "Em outros projetos", items: taken.map((row) => ({ id: row.id, name: row.name, detail: `projeto ${nameById.get(bizOf(row)!) ?? "outro"}` })) });
    return groups;
  }
  const removeButton = (target: string, targetId: string, label = "Remover") => (
    <form action={setBusinessAssociation}>
      <input name="target" type="hidden" value={target} />
      <input name="target_id" type="hidden" value={targetId} />
      <input name="business_project_id" type="hidden" value="" />
      <input name="return_to" type="hidden" value={returnTo} />
      <button type="submit" className="secondary-button">{label}</button>
    </form>
  );
  const sectionHead = (title: string, count: number) => (
    <div className="panel-heading"><div><h2>{title} · {count}</h2></div></div>
  );

  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto" />
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project.name}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow"><Link href="/dashboard/projetos">Projetos</Link> · Projeto de negócio</p><h1>{business.name}</h1><p className="dashboard-context">A associação é exclusiva: cada item pertence a no máximo um projeto, e os filtros do Dashboard e do Melhores Anúncios leem esta divisão, inclusive no histórico.</p></div></header>
    {query.status === "business-assigned" ? <div className="notice notice-success">Associação salva. Os filtros já valem com a nova divisão.</div> : null}
    {query.status === "business-invalid" ? <div className="notice notice-error">Não foi possível salvar. Revise a seleção e tente de novo.</div> : null}
    {query.status === "forbidden" ? <div className="notice notice-error">Você não possui permissão para esta ação.</div> : null}

    <section className="dashboard-panel">{sectionHead("Contas de anúncio", mine.accounts.length)}
      {mine.accounts.map((account) => <div className="folder-admin-row" key={account.id}>
        <strong>{account.name}</strong>
        {canManage ? removeButton("account", account.id) : null}
      </div>)}
      {mine.accounts.length === 0 ? <p className="dashboard-context">Nenhuma conta associada a este projeto.</p> : null}
      {canManage ? <AssociationPicker target="account" businessProjectId={business.id} returnTo={returnTo} action={setBusinessAssociation}
        groups={groupsFor(others.accounts, (row: Account) => row.business_project_id)} /> : null}
    </section>

    <section className="dashboard-panel">{sectionHead("Conexões de pagamento", mine.connections.length)}
      {mine.connections.map((connection) => <div className="folder-admin-row" key={connection.id}>
        <strong>{connection.name}</strong><span>{providerLabels[connection.provider] ?? connection.provider}</span>
        {canManage ? removeButton("connection", connection.id) : null}
      </div>)}
      {mine.connections.length === 0 ? <p className="dashboard-context">Nenhuma conexão associada a este projeto.</p> : null}
      {canManage ? <AssociationPicker target="connection" businessProjectId={business.id} returnTo={returnTo} action={setBusinessAssociation}
        groups={groupsFor(others.connections, (row: Connection) => row.business_project_id, (row: Connection) => providerLabels[row.provider] ?? row.provider)} /> : null}
    </section>

    <section className="dashboard-panel">{sectionHead("Produtos", mine.products.length)}
      {mine.products.map((product) => <div className="folder-admin-row" key={product.id}>
        <strong>{product.name}</strong>
        <span>{product.override_id === business.id ? "fixado neste projeto" : `pela conexão ${product.connection_name}`}</span>
        {canManage && product.override_id === business.id ? removeButton("product", product.id, "Voltar a herdar") : null}
      </div>)}
      {mine.products.length === 0 ? <p className="dashboard-context">Nenhum produto associado a este projeto.</p> : null}
      {canManage ? <AssociationPicker target="product" businessProjectId={business.id} returnTo={returnTo} action={setBusinessAssociation}
        groups={groupsFor(others.products, (row: Product) => row.effective_id, (row: Product) => `conexão ${row.connection_name}`)} /> : null}
    </section>

    <section className="dashboard-panel">{sectionHead("Pastas de criativos", mine.folders.length)}
      {mine.folders.map((folder) => <div className="folder-admin-row" key={folder.id}>
        <strong>{folder.name}</strong><span>{folder.creatives} criativo(s)</span>
        {canManage ? removeButton("folder", folder.id) : null}
      </div>)}
      {mine.folders.length === 0 ? <p className="dashboard-context">Nenhuma pasta associada a este projeto.</p> : null}
      {canManage ? <AssociationPicker target="folder" businessProjectId={business.id} returnTo={returnTo} action={setBusinessAssociation}
        groups={groupsFor(others.folders, (row: Folder) => row.business_project_id, (row: Folder) => `${row.creatives} criativo(s)`)} /> : null}
    </section>

    <section className="dashboard-panel">{sectionHead("Criativos", mine.creatives.length)}
      <p className="dashboard-context">A pasta é um agrupamento livre e opcional dentro do projeto: o uso principal é separar os criativos por produto quando o projeto tem mais de um, e também vale por ângulo ou leva. Criativo pode viver direto no projeto, sem pasta.</p>
      {mine.creatives.map((creative) => <div className="folder-admin-row" key={creative.id}>
        <strong>{creative.name}</strong>
        <span>{creative.folder_name ? `pasta ${creative.folder_name}` : "sem pasta"} · {creative.own_id === business.id ? "fixado no criativo" : "pelo projeto da pasta"}</span>
        {canManage ? <form action={removeCreativeFromBusinessProject}>
          <input name="creative_id" type="hidden" value={creative.id} />
          <input name="return_to" type="hidden" value={returnTo} />
          <button type="submit" className="secondary-button">Remover</button>
        </form> : null}
      </div>)}
      {mine.creatives.length === 0 ? <p className="dashboard-context">Nenhum criativo associado a este projeto.</p> : null}
      {canManage ? <AssociationPicker target="creative" businessProjectId={business.id} returnTo={returnTo} action={setBusinessAssociation}
        bulkAction={addCreativesToBusinessProject} multi
        groups={groupsFor(creatives.rows.filter((row) => row.effective_id !== business.id), (row: Creative) => row.effective_id, (row: Creative) => row.folder_name ? `pasta ${row.folder_name}` : undefined)} /> : null}
      <h3>Mover criativos entre pastas</h3>
      {mine.creatives.length === 0 ? <p className="dashboard-context">Nenhum criativo neste projeto para mover.</p> :
      <form action={moveCreativesToFolder}>
        <input name="return_to" type="hidden" value={returnTo} />
        {mine.creatives.map((creative) => <div className="folder-admin-row" key={creative.id}>
          <label><input type="checkbox" name="creative_id" value={creative.id} /> <strong>{creative.name}</strong></label><span>{creative.folder_name ? `pasta ${creative.folder_name}` : "sem pasta"}</span>
        </div>)}
        <div className="inline-filter-form">
          <label>Destino<select name="folder_id" defaultValue="">
            <option value="">Sem pasta (direto no projeto)</option>
            {projectFolders.map((folder) => <option key={folder.id} value={folder.id}>Pasta {folder.name}</option>)}
          </select></label>
          <button type="submit">Mover selecionados</button>
        </div>
      </form>}
    </section>
    </div></section></main>;
}
