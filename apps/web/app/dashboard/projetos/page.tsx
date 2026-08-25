import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {createProject,selectProject,updateProject} from "./actions";
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
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/projetos" footerLabel="Isolamento por projeto"/>
    <section className="app-content"><header className="app-topbar"><div className="project-switcher"><small>Projeto atual</small><strong>{project?(multipleOrganizations?`${project.organization_name} - ${project.name}`:project.name):"Nenhum projeto"}</strong></div><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Organização e isolamento</p><h1>Projetos</h1><p className="dashboard-context">Cada projeto possui dados, integrações, criativos e métricas independentes.</p></div></header>
    {params.status==="forbidden"?<div className="notice notice-error">Você não possui permissão para esta ação.</div>:null}
    {params.status==="invalid"?<div className="notice notice-error">Revise nome, moeda e fuso horário.</div>:null}
    {params.status==="error"?<div className="notice notice-error">Não foi possível criar o projeto. Tente novamente.</div>:null}
    {params.status==="updated"?<div className="notice notice-success">Configurações do projeto atualizadas e registradas na auditoria.</div>:null}
    <div className="integration-config-grid">{projects.map((item)=><article className="integration-config-card" key={item.id}>
      <div><p className="panel-label">{item.name}</p><span className={item.id===project?.id?"configured":""}>{item.id===project?.id?"ATUAL":item.role}</span></div>
      <p>Organização: {item.organization_name}</p>
      <p>Moeda: {item.currency} · Fuso: {item.timezone}</p><small>{item.slug}</small>
      {item.id!==project?.id?<form action={selectProject}><input name="project_id" type="hidden" value={item.id}/><input name="return_to" type="hidden" value="/dashboard"/><button>Selecionar projeto</button></form>:null}
    </article>)}</div>
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
