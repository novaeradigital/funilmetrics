import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { signOut } from "../../actions";
import { getDatabase } from "../../../../lib/database";
import { DashboardSidebar } from "../../dashboard-sidebar";
import { moveCreativesToFolder, setBusinessAssociation } from "../association-actions";

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

  const assocButton = (target: string, targetId: string, label: string, businessId: string) => (
    <form action={setBusinessAssociation} className="inline-filter-form">
      <input name="target" type="hidden" value={target} />
      <input name="target_id" type="hidden" value={targetId} />
      <input name="business_project_id" type="hidden" value={businessId} />
      <input name="return_to" type="hidden" value={returnTo} />
      <button type="submit" className={businessId ? "" : "secondary-button"}>{label}</button>
    </form>
  );
  const currentLabel = (businessId: string | null) => businessId ? (nameById.get(businessId) ?? "outro projeto") : "sem projeto";

  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto" />
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project.name}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow"><Link href="/dashboard/projetos">Projetos</Link> · Projeto de negócio</p><h1>{business.name}</h1><p className="dashboard-context">{mine.accounts.length} conta(s) · {mine.connections.length} conexão(ões) · {mine.products.length} produto(s) · {mine.creatives.length} criativo(s). A associação é exclusiva: cada item pertence a no máximo um projeto, e os filtros do Dashboard e do Melhores Anúncios leem esta divisão, inclusive no histórico.</p></div></header>
    {query.status === "business-assigned" ? <div className="notice notice-success">Associação salva. Os filtros já valem com a nova divisão.</div> : null}
    {query.status === "business-invalid" ? <div className="notice notice-error">Não foi possível salvar. Revise a seleção e tente de novo.</div> : null}
    {query.status === "forbidden" ? <div className="notice notice-error">Você não possui permissão para esta ação.</div> : null}

    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Associações</p><h2>Contas de anúncio</h2></div></div>
      {mine.accounts.map((account) => <div className="folder-admin-row" key={account.id}>
        <strong>{account.name}</strong><span>neste projeto</span>
        {canManage ? assocButton("account", account.id, "Remover do projeto", "") : null}
      </div>)}
      {others.accounts.map((account) => <div className="folder-admin-row" key={account.id}>
        <strong>{account.name}</strong><span>{currentLabel(account.business_project_id)}</span>
        {canManage ? assocButton("account", account.id, "Trazer para este projeto", business.id) : null}
      </div>)}
      {accounts.rows.length === 0 ? <p className="dashboard-context">Nenhuma conta de anúncio neste projeto do sistema.</p> : null}
    </section>

    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Associações</p><h2>Conexões de pagamento</h2></div></div>
      {mine.connections.map((connection) => <div className="folder-admin-row" key={connection.id}>
        <strong>{connection.name}</strong><span>{providerLabels[connection.provider] ?? connection.provider} · neste projeto</span>
        {canManage ? assocButton("connection", connection.id, "Remover do projeto", "") : null}
      </div>)}
      {others.connections.map((connection) => <div className="folder-admin-row" key={connection.id}>
        <strong>{connection.name}</strong><span>{providerLabels[connection.provider] ?? connection.provider} · {currentLabel(connection.business_project_id)}</span>
        {canManage ? assocButton("connection", connection.id, "Trazer para este projeto", business.id) : null}
      </div>)}
      {connections.rows.length === 0 ? <p className="dashboard-context">Nenhuma conexão de pagamento neste projeto do sistema.</p> : null}
    </section>

    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Associações</p><h2>Produtos</h2></div></div>
      <p className="dashboard-context">Produto sem projeto próprio herda o da conexão. Associar aqui fixa o projeto no produto; remover volta a herança.</p>
      {mine.products.map((product) => <div className="folder-admin-row" key={product.id}>
        <strong>{product.name}</strong><span>{product.connection_name} · {product.override_id === business.id ? "neste projeto, fixado no produto" : "neste projeto, herdado da conexão"}</span>
        {canManage && product.override_id === business.id ? assocButton("product", product.id, "Voltar a herdar da conexão", "") : null}
      </div>)}
      {others.products.map((product) => <div className="folder-admin-row" key={product.id}>
        <strong>{product.name}</strong><span>{product.connection_name} · {currentLabel(product.effective_id)}</span>
        {canManage ? assocButton("product", product.id, "Associar a este projeto", business.id) : null}
      </div>)}
      {products.rows.length === 0 ? <p className="dashboard-context">Nenhum produto neste projeto do sistema.</p> : null}
    </section>

    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Organização</p><h2>Criativos e pastas</h2></div></div>
      <p className="dashboard-context">A organização é Projeto, depois Pasta, depois Criativo, sem subpastas. A pasta é um agrupamento livre e opcional dentro do projeto: o uso principal é separar os criativos por produto quando o projeto tem mais de um, e também vale por ângulo ou leva. Criativo pode viver direto no projeto, sem pasta. Um criativo fica em uma pasta só, e o projeto da pasta vale para os criativos dela que não têm projeto próprio.</p>
      <h3>Pastas</h3>
      {mine.folders.map((folder) => <div className="folder-admin-row" key={folder.id}>
        <strong>{folder.name}</strong><span>{folder.creatives} criativo(s) · neste projeto</span>
        {canManage ? assocButton("folder", folder.id, "Remover do projeto", "") : null}
      </div>)}
      {others.folders.map((folder) => <div className="folder-admin-row" key={folder.id}>
        <strong>{folder.name}</strong><span>{folder.creatives} criativo(s) · {currentLabel(folder.business_project_id)}</span>
        {canManage ? assocButton("folder", folder.id, "Trazer para este projeto", business.id) : null}
      </div>)}
      {folders.rows.length === 0 ? <p className="dashboard-context">Nenhuma pasta de criativos. Crie pastas na Biblioteca de criativos.</p> : null}
      <h3>Criativos deste projeto</h3>
      {mine.creatives.map((creative) => <div className="folder-admin-row" key={creative.id}>
        <strong>{creative.name}</strong><span>{creative.folder_name ? `pasta ${creative.folder_name}` : "sem pasta"} · {creative.own_id === business.id ? "projeto fixado no criativo" : "projeto herdado"}</span>
        {canManage && creative.own_id === business.id ? assocButton("creative", creative.id, "Tirar o projeto do criativo", "") : null}
      </div>)}
      {mine.creatives.length === 0 ? <p className="dashboard-context">Nenhum criativo neste projeto ainda.</p> : null}
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
