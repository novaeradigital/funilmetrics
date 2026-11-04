import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {createProject,selectProject,updateProject} from "./actions";
import {assignBusinessProject,createBusinessProject,deleteBusinessProject,renameBusinessProject} from "./business-actions";
import {loadBusinessProjects} from "../../../lib/business-projects";
import {getDatabase} from "../../../lib/database";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
export default async function ProjectsPage({searchParams}:{searchParams:Promise<{status?:string}>}){
  const params=await searchParams;const supabase=await createClient();
  const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
  const {projects,project}=await getActiveProject(data.user.id);
  const database=getDatabase();
  const creationOrganizations=await database.pool.query<{id:string;name:string}>(
    `select organization.id,organization.name
       from public.users app_user
       join public.memberships membership on membership.user_id=app_user.id
       join public.organizations organization
         on organization.id=membership.organization_id
      where app_user.auth_user_id=$1 and app_user.status='active'
        and membership.role in('owner','administrator')
        and ($2::uuid is null or membership.organization_id=$2)
      order by organization.name`,
    [data.user.id,project?.organization_id??null],
  );
  const canCreate=creationOrganizations.rows.length>0;
  const canManageActive=Boolean(project&&["owner","administrator"].includes(project.role));
  const multipleOrganizations=new Set(projects.map((item)=>item.organization_id)).size>1;
  const businessProjects=project?await loadBusinessProjects(database.pool,project.id).catch(()=>[] as {id:string;name:string}[]):[];
  type BizAccount={id:string;name:string;business_project_id:string|null};
  type BizConnection={id:string;provider:string;name:string;business_project_id:string|null};
  type BizProduct={id:string;name:string;connection_name:string;override_id:string|null;effective_id:string|null};
  const bizAccounts=project?(await database.pool.query<BizAccount>(`select id,name,business_project_id::text as business_project_id from public.meta_ad_accounts where project_id=$1 order by name`,[project.id])).rows:[];
  const bizConnections=project?(await database.pool.query<BizConnection>(`select connection.id,connection.provider,connection.name,connection.business_project_id::text as business_project_id from public.connections connection where connection.project_id=$1 and (connection.provider in ('lastlink','configcheckout') or exists(select 1 from public.commerce_orders orders where orders.connection_id=connection.id)) order by connection.provider,connection.name`,[project.id])).rows:[];
  const bizProducts=project?(await database.pool.query<BizProduct>(`select product.id,product.name,connection.name as connection_name,product.business_project_id::text as override_id,coalesce(product.business_project_id,connection.business_project_id)::text as effective_id from public.commerce_products product join public.connections connection on connection.id=product.connection_id where product.project_id=$1 and product.data_scope='production' order by product.name`,[project.id])).rows:[];
  const bizUnassigned=project?(await database.pool.query<{accounts:number;connections:number;products:number;creatives:number}>(`select
    (select count(*)::int from public.meta_ad_accounts where project_id=$1 and business_project_id is null) as accounts,
    (select count(*)::int from public.connections connection where connection.project_id=$1 and connection.business_project_id is null and (connection.provider in ('lastlink','configcheckout') or exists(select 1 from public.commerce_orders orders where orders.connection_id=connection.id))) as connections,
    (select count(*)::int from public.commerce_products product join public.connections connection on connection.id=product.connection_id where product.project_id=$1 and product.data_scope='production' and coalesce(product.business_project_id,connection.business_project_id) is null) as products,
    (select count(*)::int from public.creatives where project_id=$1 and business_project_id is null) as creatives`,[project.id])).rows[0]:undefined;
  const businessNameById=new Map(businessProjects.map((item)=>[item.id,item.name]));
  const providerLabels:Record<string,string>={lastlink:"Lastlink",configcheckout:"Checkout próprio"};
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto"/>
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project?(multipleOrganizations?`${project.organization_name} - ${project.name}`:project.name):"Nenhum projeto"}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Organização e isolamento</p><h1>Projetos</h1><p className="dashboard-context">Cada projeto possui dados, integrações, criativos e métricas independentes.</p></div></header>
    {params.status==="forbidden"?<div className="notice notice-error">Você não possui permissão para esta ação.</div>:null}
    {params.status==="invalid"?<div className="notice notice-error">Revise nome, moeda e fuso horário.</div>:null}
    {params.status==="error"?<div className="notice notice-error">Não foi possível criar o projeto. Tente novamente.</div>:null}
    {params.status==="updated"?<div className="notice notice-success">Configurações do projeto atualizadas e registradas na auditoria.</div>:null}
    {params.status==="business-created"?<div className="notice notice-success">Projeto de negócio criado. Associe as contas, conexões e produtos na seção abaixo.</div>:null}
    {params.status==="business-assigned"?<div className="notice notice-success">Associação salva. Os filtros já valem com a nova divisão, inclusive no histórico.</div>:null}
    {params.status==="business-renamed"?<div className="notice notice-success">Projeto de negócio renomeado.</div>:null}
    {params.status==="business-deleted"?<div className="notice notice-success">Projeto de negócio excluído. As associações dele foram desfeitas e os itens voltaram para Sem projeto.</div>:null}
    {params.status==="business-duplicate"?<div className="notice notice-error">Já existe um projeto de negócio com esse nome neste projeto.</div>:null}
    {params.status==="business-invalid"?<div className="notice notice-error">Revise os dados do projeto de negócio.</div>:null}
    <div className="integration-config-grid">{projects.map((item)=><article className="integration-config-card" key={item.id}>
      <div><p className="panel-label">{item.name}</p><span className={item.id===project?.id?"configured":""}>{item.id===project?.id?"ATUAL":item.role}</span></div>
      <p>Organização: {item.organization_name}</p>
      <p>Moeda: {item.currency} · Fuso: {item.timezone}</p><small>{item.slug}</small>
      {item.id!==project?.id?<form action={selectProject}><input name="project_id" type="hidden" value={item.id}/><input name="return_to" type="hidden" value="/dashboard"/><button>Selecionar projeto</button></form>:null}
    </article>)}</div>
    {project?<section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Projetos de negócio</p><h2>Agrupar contas, produtos e criativos por operação</h2><p className="dashboard-context">O projeto de negócio é um rótulo de leitura: ele diz o que é de cada operação para o Dashboard e o Melhores Anúncios filtrarem sem misturar os números. Não separa dados, integrações nem sincronizações, e vale também para o histórico. O que ficar sem projeto aparece em Todos os projetos e em nenhum projeto específico.</p></div></div>
    {bizUnassigned&&(bizUnassigned.accounts+bizUnassigned.connections+bizUnassigned.products+bizUnassigned.creatives)>0?<div className="notice">Sem projeto: {bizUnassigned.accounts} conta(s) de anúncio, {bizUnassigned.connections} conexão(ões) de pagamento, {bizUnassigned.products} produto(s) e {bizUnassigned.creatives} criativo(s). Associe abaixo para os filtros ficarem completos.</div>:null}
    {canManageActive?<form action={createBusinessProject} className="inline-filter-form">
      <label>Nome do projeto<input name="name" placeholder="Ex.: Alivzon" required/></label>
      <button type="submit">Criar projeto de negócio</button>
    </form>:null}
    <div className="integration-config-grid">{businessProjects.map((item)=>{
      const contasN=bizAccounts.filter((a)=>a.business_project_id===item.id).length;
      const conexoesN=bizConnections.filter((c)=>c.business_project_id===item.id).length;
      const produtosN=bizProducts.filter((pr)=>pr.effective_id===item.id).length;
      return <article className="integration-config-card" key={item.id}>
      <div><p className="panel-label">{item.name}</p></div>
      <p>{contasN} conta(s) · {conexoesN} conexão(ões) · {produtosN} produto(s)</p>
      {canManageActive?<>
        <form action={renameBusinessProject} className="inline-filter-form">
          <input name="business_id" type="hidden" value={item.id}/>
          <label>Renomear<input defaultValue={item.name} name="name" required/></label>
          <button type="submit">Salvar nome</button>
        </form>
        <form action={deleteBusinessProject}>
          <input name="business_id" type="hidden" value={item.id}/>
          <button className="secondary-button" type="submit">Excluir projeto</button>
        </form>
      </>:null}
    </article>})}</div>
    <h3>Contas de anúncio</h3>
    {bizAccounts.map((account)=><div className="folder-admin-row" key={account.id}>
      <strong>{account.name}</strong>
      {canManageActive?<form action={assignBusinessProject} className="inline-filter-form">
        <input name="target" type="hidden" value="account"/>
        <input name="target_id" type="hidden" value={account.id}/>
        <label>Projeto<select defaultValue={account.business_project_id??""} name="business_project_id">
          <option value="">Sem projeto</option>
          {businessProjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button type="submit">Salvar</button>
      </form>:<span>{account.business_project_id?(businessNameById.get(account.business_project_id)??"Sem projeto"):"Sem projeto"}</span>}
    </div>)}
    <h3>Conexões de pagamento</h3>
    {bizConnections.map((connection)=><div className="folder-admin-row" key={connection.id}>
      <strong>{connection.name}</strong><span>{providerLabels[connection.provider]??connection.provider}</span>
      {canManageActive?<form action={assignBusinessProject} className="inline-filter-form">
        <input name="target" type="hidden" value="connection"/>
        <input name="target_id" type="hidden" value={connection.id}/>
        <label>Projeto<select defaultValue={connection.business_project_id??""} name="business_project_id">
          <option value="">Sem projeto</option>
          {businessProjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button type="submit">Salvar</button>
      </form>:<span>{connection.business_project_id?(businessNameById.get(connection.business_project_id)??"Sem projeto"):"Sem projeto"}</span>}
    </div>)}
    <h3>Produtos</h3>
    <p className="dashboard-context">Produto sem projeto próprio herda o da conexão. Use o campo do produto só para corrigir exceções.</p>
    {bizProducts.map((product)=><div className="folder-admin-row" key={product.id}>
      <strong>{product.name}</strong><span>{product.connection_name} · hoje vale {product.effective_id?(businessNameById.get(product.effective_id)??"sem projeto"):"sem projeto"}</span>
      {canManageActive?<form action={assignBusinessProject} className="inline-filter-form">
        <input name="target" type="hidden" value="product"/>
        <input name="target_id" type="hidden" value={product.id}/>
        <label>Projeto<select defaultValue={product.override_id??""} name="business_project_id">
          <option value="">Automático (herda da conexão)</option>
          {businessProjects.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button type="submit">Salvar</button>
      </form>:null}
    </div>)}
    <p className="dashboard-context">Criativos se associam na Biblioteca: filtro por projeto e campo Projeto em cada cartão. E criativo publicado numa conta herda o projeto dela quando ainda não tem nenhum.</p>
    </section>:null}
    {project&&canManageActive?<section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Projeto ativo</p><h2>Configurações</h2></div></div>
      <form action={updateProject} className="integration-config-grid">
        <input name="project_id" type="hidden" value={project.id}/>
        <label>Nome<input defaultValue={project.name} name="name" required/></label>
        <label>Moeda<select defaultValue={project.currency} name="currency"><option value="BRL">BRL</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
        <label>Fuso horário<select defaultValue={project.timezone} name="timezone"><option value="America/Sao_Paulo">São Paulo</option><option value="America/New_York">Nova York</option><option value="Europe/Lisbon">Lisboa</option><option value="UTC">UTC</option></select></label>
        <button type="submit">Salvar configurações</button>
      </form></section>:null}
    {canCreate?<section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Novo escopo</p><h2>Criar projeto</h2></div></div>
      <form action={createProject} className="integration-config-grid">
        {project?<input name="organization_id" type="hidden" value={project.organization_id}/>:<label>Organização<select name="organization_id" required>{creationOrganizations.rows.map((organization)=><option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
        <label>Nome<input name="name" required/></label><label>Moeda<select defaultValue="BRL" name="currency"><option value="BRL">BRL</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
        <label>Fuso horário<select defaultValue="America/Sao_Paulo" name="timezone"><option value="America/Sao_Paulo">São Paulo</option><option value="America/New_York">Nova York</option><option value="Europe/Lisbon">Lisboa</option><option value="UTC">UTC</option></select></label>
        <button type="submit">Criar e selecionar</button>
      </form></section>:<div className="permission-state"><strong>Sem permissão para criar projetos</strong><p>Solicite acesso de proprietário ou administrador.</p></div>}
    </div></section></main>;
}
