import Link from "next/link";
import {redirect} from "next/navigation";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {dashboardMetricCatalog,getDashboardMetric} from "../../../lib/dashboard-metrics";
import {loadDashboardMetricSeries,loadDashboardMetricValues} from "../../../lib/dashboard-metric-values";
import type {DashboardMetricSeries,DashboardMetricValues} from "../../../lib/dashboard-metric-values";
import {createClient} from "../../../lib/supabase/server";
import {addDashboardWidget,archiveDashboard,createDashboard,createDashboardFromTemplate,
 createDashboardWithAi,grantDashboardAccess,publishDashboard,restoreDashboardVersion,revokeDashboardAccess,
 updateDashboardFilters,updateDashboardPeriod} from "./actions";
import {DashboardGridEditor,type EditableWidget} from "./dashboard-grid-editor";
import {dashboardTemplates} from "../../../lib/dashboard-templates";
import {canEditDashboard,canManageDashboardAccess} from "../../../lib/dashboard-permissions";

type Filters={productId?:string|null;accountId?:string|null;campaignId?:string|null;periodDays?:number};
type DashboardRow={id:string;name:string;description:string|null;default_period_days:number;
 draft_id:string|null;draft_number:number|null;draft_filters:Filters|null;
 published_id:string|null;published_number:number|null;published_filters:Filters|null};
type WidgetRow={id:string;widget_type:string;title:string;metric_key:string|null;
 grid_x:number;grid_y:number;grid_width:number;grid_height:number;display_order:number};
type VersionRow={id:string;version_number:number;status:string;published_at:string|null;widget_count:number};
type OptionRow={id:string;name:string};
type MembershipRow={id:string};
type DashboardAccessRow={membership_id:string;access_level:"view"|"edit";display_name:string|null;email:string};
const messages:Record<string,string>={created:"Dashboard criado com um rascunho.",
 "widget-created":"Widget adicionado ao rascunho.",published:"Versão publicada e novo rascunho preparado.",
 archived:"Dashboard arquivado sem apagar o histórico.","layout-saved":"Organização do rascunho salva.",
 "period-saved":"Período global atualizado.","template-created":"Dashboard criado a partir do template.",
 restored:"Versão publicada copiada para o rascunho atual.","filters-saved":"Filtros do rascunho atualizados.",
 "access-saved":"Acesso ao dashboard atualizado.","access-revoked":"Acesso individual removido.",
 "ai-created":"Sugestão da IA criada como rascunho para sua revisão.",
 "widget-updated":"Widget atualizado no rascunho.","widget-duplicated":"Widget duplicado no rascunho.",
 "widget-removed":"Widget removido do rascunho. Versões publicadas foram preservadas."};

export default async function Page({searchParams}:{searchParams:Promise<{id?:string;status?:string;mode?:string}>}){
 const query=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");const database=getDatabase();
 const membership=(await database.pool.query<MembershipRow>(`select membership.id from public.memberships membership
  join public.users app_user on app_user.id=membership.user_id
  where app_user.auth_user_id=$1 and membership.organization_id=$2 limit 1`,
  [data.user.id,project.organization_id])).rows[0];
 if(!membership)redirect("/dashboard?status=forbidden");
 const canManageAccess=canManageDashboardAccess(project.role);
 const dashboards=(await database.pool.query<DashboardRow>(`select dashboard.id,dashboard.name,
  dashboard.description,dashboard.default_period_days,draft.id draft_id,draft.version_number draft_number,
  draft.global_filters draft_filters,published.id published_id,published.version_number published_number,
  published.global_filters published_filters from public.dashboards dashboard
  left join public.dashboard_versions draft on draft.dashboard_id=dashboard.id and draft.status='draft'
  left join lateral(select id,version_number,global_filters from public.dashboard_versions version where
   version.dashboard_id=dashboard.id and version.status='published' order by version_number desc limit 1)
   published on true where dashboard.project_id=$1 and dashboard.status='active' and ($3::boolean or
    not exists(select 1 from public.dashboard_access access where access.dashboard_id=dashboard.id) or
    exists(select 1 from public.dashboard_access access where access.dashboard_id=dashboard.id
     and access.membership_id=$2))
  order by dashboard.updated_at desc`,[project.id,membership.id,canManageAccess])).rows;
 const selected=dashboards.find(item=>item.id===query.id)??dashboards[0]??null;
 const selectedAccess=selected?(await database.pool.query<{access_level:"view"|"edit"}>(
  `select access_level from public.dashboard_access where dashboard_id=$1 and membership_id=$2`,
  [selected.id,membership.id])).rows[0]?.access_level??null:null;
 const hasEditRole=canEditDashboard(project.role,selectedAccess);
 const editDenied=query.mode==="edit"&&!hasEditRole;
 const editMode=query.mode==="edit"&&hasEditRole;
 const versionId=selected?(editMode?selected.draft_id:(selected.published_id??selected.draft_id)):null;
 const activeFilters={...((editMode?selected?.draft_filters:selected?.published_filters)??selected?.draft_filters??{}),
  timezone:project.timezone};
 const widgets=versionId?(await database.pool.query<WidgetRow>(`select id,widget_type,title,metric_key,
  grid_x,grid_y,grid_width,grid_height,display_order
  from public.dashboard_widgets where dashboard_version_id=$1 and project_id=$2 order by display_order,id`,
  [versionId,project.id])).rows:[];
 const versions=selected?(await database.pool.query<VersionRow>(`select version.id,version.version_number,
  version.status,version.published_at::text,count(widget.id)::int widget_count
  from public.dashboard_versions version left join public.dashboard_widgets widget
   on widget.dashboard_version_id=version.id where version.dashboard_id=$1 and version.project_id=$2
  group by version.id order by version.version_number desc`,[selected.id,project.id])).rows:[];
 const accessRows=selected&&canManageAccess?(await database.pool.query<DashboardAccessRow>(
  `select access.membership_id,access.access_level,app_user.display_name,app_user.email
   from public.dashboard_access access join public.memberships membership on membership.id=access.membership_id
   join public.users app_user on app_user.id=membership.user_id
   where access.dashboard_id=$1 order by coalesce(app_user.display_name,app_user.email)`,
  [selected.id])).rows:[];
 const accessCandidates=selected&&canManageAccess?(await database.pool.query<DashboardAccessRow>(
  `select membership.id membership_id,'view'::text access_level,app_user.display_name,app_user.email
   from public.memberships membership join public.users app_user on app_user.id=membership.user_id
   where membership.organization_id=$1 and app_user.status='active' and membership.id<>$2
   and (not exists(select 1 from public.project_memberships restricted where restricted.membership_id=membership.id)
    or exists(select 1 from public.project_memberships allowed where allowed.membership_id=membership.id
     and allowed.project_id=$3))
   order by coalesce(app_user.display_name,app_user.email)`,
  [project.organization_id,membership.id,project.id])).rows:[];
 const products=(await database.pool.query<OptionRow>(`select id,name from public.commerce_products
  where project_id=$1 and data_scope='production' order by name`,[project.id])).rows;
 const accounts=(await database.pool.query<OptionRow>(`select id,name from public.meta_ad_accounts
  where project_id=$1 order by name`,[project.id])).rows;
 const campaigns=(await database.pool.query<OptionRow>(`select id,name from public.meta_campaigns
  where project_id=$1 and ($2::uuid is null or meta_ad_account_id=$2) order by name`,
  [project.id,activeFilters.accountId??null])).rows;
 const periodDays=activeFilters.periodDays??selected?.default_period_days??30;
 const values:DashboardMetricValues=selected
  ?await loadDashboardMetricValues(database,project.id,periodDays,activeFilters):{};
 const series:DashboardMetricSeries=selected
  ?await loadDashboardMetricSeries(database,project.id,periodDays,activeFilters):{};
 const money=(currency:string)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency});
 const integer=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:0});
 const editableWidgets:EditableWidget[]=widgets.map(widget=>{const metric=widget.metric_key?
  getDashboardMetric(widget.metric_key):null;const value=metric?values[metric.key]:null;
  return {...widget,value:value?.available?(metric?.format==="currency"
   ?money(value.currency??project.currency).format(value.value):integer.format(value.value)):"Indisponível",
   available:Boolean(value?.available),metric_label:metric?.label??null,rule_version:metric?.ruleVersion??null,
   description:metric?.description??null,series:metric?series[metric.key]??[]:[]};});
 const canEdit=hasEditRole&&editMode;
 const failed=Boolean(query.status?.includes("failed")||query.status?.includes("invalid")
  ||query.status==="forbidden"||query.status==="ai-budget");
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/dashboards"
  footerLabel="Dashboards versionados"/><section className="app-content">
  <DashboardTopbar returnTo="/dashboard/dashboards" statusLabel="Métricas governadas"/>
  <div className="dashboard-main dashboard-builder-page">
   {query.status&&messages[query.status]?<div className="status-banner success">{messages[query.status]}</div>:null}
   {failed?<div className="status-banner error">{query.status==="ai-budget"
    ?"O limite mensal configurado para IA foi atingido.":"Não foi possível concluir a operação."}</div>:null}
   {editDenied?<div className="status-banner warning">Seu acesso a este dashboard é somente para visualização.</div>:null}
   <header className="dashboard-titlebar"><div><p className="eyebrow">Personalização analítica</p>
    <h1>Dashboards</h1><p className="dashboard-context">Combine métricas governadas sem alterar suas fórmulas.</p>
   </div></header>
   <div className="custom-dashboard-shell"><aside className="custom-dashboard-library">
    <div className="custom-dashboard-library-title"><strong>Seus dashboards</strong><span>{dashboards.length}</span></div>
    {dashboards.length?dashboards.map(item=><Link className={item.id===selected?.id?"active":""}
     href={`/dashboard/dashboards?id=${item.id}${editMode?"&mode=edit":""}`} key={item.id}><strong>{item.name}</strong>
     <small>{item.published_number?`Publicada v${item.published_number}`:"Somente rascunho"}</small></Link>):
     <div className="compact-empty">Nenhum dashboard criado.</div>}
    {hasEditRole?<details className="dashboard-create-panel"><summary>Novo dashboard</summary>
     <form action={createDashboard}><label>Nome<input name="name" required minLength={2} maxLength={120}/></label>
      <label>Descrição<textarea name="description" maxLength={500}/></label>
      <label>Período padrão<select name="period_days" defaultValue="30"><option value="7">7 dias</option>
       <option value="30">30 dias</option><option value="90">90 dias</option><option value="365">365 dias</option>
      </select></label><button type="submit">Criar rascunho</button></form>
    </details>:null}
    {hasEditRole?<details className="dashboard-create-panel"><summary>Usar template</summary>
     <div className="dashboard-template-list">{dashboardTemplates.map(template=>
      <form action={createDashboardFromTemplate} key={template.key}>
       <input type="hidden" name="template" value={template.key}/><strong>{template.name}</strong>
       <small>{template.description}</small><button type="submit">Criar</button>
      </form>)}</div>
    </details>:null}
    {hasEditRole?<details className="dashboard-create-panel dashboard-ai-panel"><summary>Criar com IA</summary>
     <form action={createDashboardWithAi}><label>Descreva o objetivo
      <textarea name="prompt" required minLength={10} maxLength={1000}
       placeholder="Ex.: acompanhe receita, vendas, investimento e eficiência da mídia nos últimos 30 dias"/>
     </label><small>A IA usa somente métricas governadas e cria um rascunho. Nada será publicado automaticamente.</small>
      <button type="submit">Gerar rascunho</button></form>
    </details>:null}
   </aside><section className="custom-dashboard-canvas">{selected?<><header className="custom-dashboard-header">
    <div><span className="eyebrow">{editMode?`Rascunho v${selected.draft_number}`:
     selected.published_number?`Publicada v${selected.published_number}`:`Prévia do rascunho v${selected.draft_number}`}</span>
     <h2>{selected.name}</h2>
     <p>{selected.description||"Sem descrição."}</p></div>{canEdit?<div className="custom-dashboard-actions">
      <form action={updateDashboardPeriod} className="dashboard-period-form">
       <input type="hidden" name="dashboard_id" value={selected.id}/><select name="period_days"
        defaultValue={String(periodDays)} aria-label="Período global">
        <option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option>
        <option value="365">365 dias</option></select><button type="submit">Aplicar</button></form>
      <form action={publishDashboard}><input type="hidden" name="dashboard_id" value={selected.id}/>
       <button type="submit">Publicar versão</button></form><details><summary>Mais</summary>
       <form action={archiveDashboard}><input type="hidden" name="dashboard_id" value={selected.id}/>
        <button className="button-danger" type="submit">Arquivar dashboard</button></form></details>
     </div>:<div className="custom-dashboard-actions">{hasEditRole?<Link className="button-link"
      href={`/dashboard/dashboards?id=${selected.id}&mode=edit`}>Editar dashboard</Link>:null}</div>}</header>
    <nav className="dashboard-mode-tabs" aria-label="Modo do dashboard">
     <Link className={!editMode?"active":""} href={`/dashboard/dashboards?id=${selected.id}`}>Visualizar</Link>
     {hasEditRole?<Link className={editMode?"active":""}
      href={`/dashboard/dashboards?id=${selected.id}&mode=edit`}>Editar</Link>:null}
    </nav>
    {canEdit?<form action={updateDashboardFilters} className="dashboard-global-filters">
     <input type="hidden" name="dashboard_id" value={selected.id}/>
     <label>Produto<select name="product_id" defaultValue={activeFilters.productId??""}><option value="">Todos</option>
      {products.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     <label>Conta Meta<select name="account_id" defaultValue={activeFilters.accountId??""}><option value="">Todas</option>
      {accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     <label>Campanha<select name="campaign_id" defaultValue={activeFilters.campaignId??""}><option value="">Todas</option>
      {campaigns.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     <button type="submit">Salvar filtros</button>
    </form>:<div className="dashboard-filter-summary"><span>Produto: {products.find(item=>item.id===activeFilters.productId)?.name??"Todos"}</span>
     <span>Conta: {accounts.find(item=>item.id===activeFilters.accountId)?.name??"Todas"}</span>
     <span>Campanha: {campaigns.find(item=>item.id===activeFilters.campaignId)?.name??"Todas"}</span></div>}
    <DashboardGridEditor dashboardId={selected.id} initialWidgets={editableWidgets} canEdit={canEdit}/>
    {canEdit?<details className="dashboard-widget-composer" open={!widgets.length}><summary>Adicionar widget</summary>
     <form action={addDashboardWidget}><input type="hidden" name="dashboard_id" value={selected.id}/>
      <label>Título<input name="title" required minLength={2} maxLength={120}/></label>
      <label>Visualização<select name="widget_type" defaultValue="kpi"><option value="kpi">Indicador</option>
       <option value="time_series">Série temporal</option><option value="bar">Barras</option>
       <option value="donut">Rosca</option><option value="funnel">Funil</option>
       <option value="table">Tabela</option><option value="comparison">Comparação</option></select></label>
      <label>Métrica<select name="metric_key">{dashboardMetricCatalog.map(metric=>
       <option key={metric.key} value={metric.key}>{metric.label}</option>)}</select></label>
      <button type="submit">Adicionar ao rascunho</button></form>
    </details>:null}
    <details className="dashboard-version-history"><summary>Histórico de versões</summary>
     <div>{versions.map(version=><article key={version.id}><span><strong>Versão {version.version_number}</strong>
      <small>{version.status} · {version.widget_count} widget(s){version.published_at
       ?` · ${new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(version.published_at))}`:""}</small>
      </span>{canEdit&&version.status==="published"?<form action={restoreDashboardVersion}>
       <input type="hidden" name="dashboard_id" value={selected.id}/><input type="hidden" name="version_id" value={version.id}/>
       <button type="submit">Restaurar no rascunho</button></form>:null}</article>)}</div>
    </details>
    {canManageAccess&&editMode?<details className="dashboard-access-panel"><summary>Acesso ao dashboard</summary>
     <p>Sem concessões individuais, o dashboard herda o acesso do projeto. Ao adicionar alguém, ele passa a ser restrito aos membros listados e aos administradores.</p>
     <form action={grantDashboardAccess}><input type="hidden" name="dashboard_id" value={selected.id}/>
      <label>Membro<select name="membership_id" required defaultValue=""><option value="" disabled>Selecione</option>
       {accessCandidates.map(item=><option key={item.membership_id} value={item.membership_id}>
        {item.display_name||item.email}</option>)}</select></label>
      <label>Nível<select name="access_level" defaultValue="view"><option value="view">Visualizar</option>
       <option value="edit">Editar</option></select></label><button type="submit">Salvar acesso</button>
     </form>
     <div className="dashboard-access-list">{accessRows.length?accessRows.map(item=><article key={item.membership_id}>
      <span><strong>{item.display_name||item.email}</strong><small>{item.access_level==="edit"?"Pode editar":"Somente visualizar"}</small></span>
      <form action={revokeDashboardAccess}><input type="hidden" name="dashboard_id" value={selected.id}/>
       <input type="hidden" name="membership_id" value={item.membership_id}/><button type="submit">Remover</button></form>
     </article>):<div className="compact-empty">Acesso herdado do projeto.</div>}</div>
    </details>:null}
    </>:<div className="custom-dashboard-empty"><strong>Crie o primeiro dashboard</strong>
     <p>Ele ficará isolado no projeto {project.name}.</p></div>}</section></div>
  </div></section></main>;
}
