import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {createBusinessProject,deleteBusinessProject,renameBusinessProject} from "./business-actions";
import {ProjectCard} from "./project-card";
import {loadBusinessProjects} from "../../../lib/business-projects";
import {getDatabase} from "../../../lib/database";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
export default async function ProjectsPage({searchParams}:{searchParams:Promise<{status?:string}>}){
  const params=await searchParams;const supabase=await createClient();
  const {data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
  const {projects,project}=await getActiveProject(data.user.id);
  const database=getDatabase();
  const canManageActive=Boolean(project&&["owner","administrator"].includes(project.role));
  const multipleOrganizations=new Set(projects.map((item)=>item.organization_id)).size>1;
  const businessProjects=project?await loadBusinessProjects(database.pool,project.id).catch(()=>[] as {id:string;name:string}[]):[];
  type BizAccount={id:string;name:string;business_project_id:string|null};
  type BizConnection={id:string;provider:string;name:string;business_project_id:string|null};
  type BizProduct={id:string;name:string;connection_name:string;override_id:string|null;effective_id:string|null};
  const bizAccounts=project?(await database.pool.query<BizAccount>(`select id,name,business_project_id::text as business_project_id from public.meta_ad_accounts where project_id=$1 order by name`,[project.id])).rows:[];
  const bizConnections=project?(await database.pool.query<BizConnection>(`select connection.id,connection.provider,connection.name,connection.business_project_id::text as business_project_id from public.connections connection where connection.project_id=$1 and (connection.provider in ('lastlink','configcheckout') or exists(select 1 from public.commerce_orders orders where orders.connection_id=connection.id)) order by connection.provider,connection.name`,[project.id])).rows:[];
  const bizProducts=project?(await database.pool.query<BizProduct>(`select product.id,product.name,connection.name as connection_name,product.business_project_id::text as override_id,coalesce(product.business_project_id,connection.business_project_id)::text as effective_id from public.commerce_products product join public.connections connection on connection.id=product.connection_id where product.project_id=$1 and product.data_scope='production' order by product.name`,[project.id])).rows:[];
  const bizCreatives=project?(await database.pool.query<{effective_id:string|null}>(`select coalesce(creative.business_project_id,folder.business_project_id)::text as effective_id from public.creatives creative left join public.creative_folders folder on folder.id=creative.folder_id where creative.project_id=$1`,[project.id])).rows:[] as {effective_id:string|null}[];
  const bizUnassigned=project?(await database.pool.query<{accounts:number;connections:number;products:number;creatives:number}>(`select
    (select count(*)::int from public.meta_ad_accounts where project_id=$1 and business_project_id is null) as accounts,
    (select count(*)::int from public.connections connection where connection.project_id=$1 and connection.business_project_id is null and (connection.provider in ('lastlink','configcheckout') or exists(select 1 from public.commerce_orders orders where orders.connection_id=connection.id))) as connections,
    (select count(*)::int from public.commerce_products product join public.connections connection on connection.id=product.connection_id where product.project_id=$1 and product.data_scope='production' and coalesce(product.business_project_id,connection.business_project_id) is null) as products,
    (select count(*)::int from public.creatives creative left join public.creative_folders folder on folder.id=creative.folder_id where creative.project_id=$1 and coalesce(creative.business_project_id,folder.business_project_id) is null) as creatives`,[project.id])).rows[0]:undefined;
  const businessNameById=new Map(businessProjects.map((item)=>[item.id,item.name]));
  const providerLabels:Record<string,string>={lastlink:"Lastlink",configcheckout:"Checkout próprio"};
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto"/>
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project?(multipleOrganizations?`${project.organization_name} - ${project.name}`:project.name):"Nenhum projeto"}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Organização e isolamento</p><h1>Projetos</h1><p className="dashboard-context">Cada projeto possui dados, integrações, criativos e métricas independentes.</p></div></header>
    {params.status==="forbidden"?<div className="notice notice-error">Você não possui permissão para esta ação.</div>:null}
    {params.status==="invalid"?<div className="notice notice-error">Revise nome, moeda e fuso horário.</div>:null}
    {params.status==="error"?<div className="notice notice-error">Não foi possível criar o projeto. Tente novamente.</div>:null}
    {params.status==="updated"?<div className="notice notice-success">Configurações do projeto atualizadas e registradas na auditoria.</div>:null}
    {params.status==="business-created"?<div className="notice notice-success">Projeto de negócio criado. Abra o projeto para associar contas, conexões, produtos e criativos.</div>:null}
    {params.status==="business-assigned"?<div className="notice notice-success">Associação salva. Os filtros já valem com a nova divisão, inclusive no histórico.</div>:null}
    {params.status==="business-renamed"?<div className="notice notice-success">Projeto de negócio renomeado.</div>:null}
    {params.status==="business-deleted"?<div className="notice notice-success">Projeto de negócio excluído. As associações dele foram desfeitas e os itens voltaram para Sem projeto.</div>:null}
    {params.status==="business-duplicate"?<div className="notice notice-error">Já existe um projeto de negócio com esse nome neste projeto.</div>:null}
    {params.status==="business-invalid"?<div className="notice notice-error">Revise os dados do projeto de negócio.</div>:null}
    {project?<section className="dashboard-panel"><div className="panel-heading"><div><h2>Agrupar contas, produtos e criativos por operação</h2></div></div>
    {canManageActive?<form action={createBusinessProject} className="inline-filter-form">
      <label>Nome do projeto<input name="name" placeholder="Ex.: Alivzon" required/></label>
      <button type="submit">Criar projeto de negócio</button>
    </form>:null}
    <div className="integration-config-grid">{businessProjects.map((item)=>{
      const contasN=bizAccounts.filter((a)=>a.business_project_id===item.id).length;
      const conexoesNomes=bizConnections.filter((c)=>c.business_project_id===item.id).map((c)=>c.name);
      const produtosNomes=bizProducts.filter((pr)=>pr.effective_id===item.id).map((pr)=>pr.name);
      const criativosN=bizCreatives.filter((cr)=>cr.effective_id===item.id).length;
      return <ProjectCard key={item.id} id={item.id} name={item.name} canManage={canManageActive}
        counts={{contas:contasN, conexoesNomes, produtosNomes, criativos:criativosN}}
        renameAction={renameBusinessProject} deleteAction={deleteBusinessProject}/>;
    })}
    {bizUnassigned&&(bizUnassigned.accounts+bizUnassigned.connections+bizUnassigned.products+bizUnassigned.creatives)>0?<article className="integration-config-card"><Link href="/dashboard/projetos/sem-projeto" style={{textDecoration:"none", color:"inherit", display:"block"}}>
      <div><p className="panel-label">Sem projeto</p></div>
      <ul style={{listStyle:"none", margin:"8px 0 2px", padding:0, display:"grid", gap:1, lineHeight:1.5, fontSize:"0.85rem", color:"var(--fm-text-soft)"}}>
        <li style={{border:0, background:"transparent", padding:0, margin:0}}>{bizUnassigned.accounts} {bizUnassigned.accounts===1?"conta":"contas"}</li>
        <li style={{border:0, background:"transparent", padding:0, margin:0}}>{bizUnassigned.connections} {bizUnassigned.connections===1?"conexão":"conexões"}</li>
        <li style={{border:0, background:"transparent", padding:0, margin:0}}>{bizUnassigned.products} {bizUnassigned.products===1?"produto":"produtos"}</li>
        <li style={{border:0, background:"transparent", padding:0, margin:0}}>{bizUnassigned.creatives} {bizUnassigned.creatives===1?"criativo":"criativos"}</li>
      </ul>
      <p>Distribuir os itens sem projeto</p>
    </Link></article>:null}</div>
    </section>:null}
    </div></section></main>;
}
