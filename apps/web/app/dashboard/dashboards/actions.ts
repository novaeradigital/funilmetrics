"use server";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {getDashboardMetric} from "../../../lib/dashboard-metrics";
import {getDashboardTemplate} from "../../../lib/dashboard-templates";
import {canEditDashboard,canManageDashboardAccess} from "../../../lib/dashboard-permissions";
import {proposeDashboard} from "../../../lib/dashboard-ai";
import {createClient} from "../../../lib/supabase/server";

const roles=new Set(["owner","administrator","editor"]);
const widgetTypes=new Set(["kpi","time_series","bar","donut","funnel","table","comparison","note"]);
async function scope(dashboardId?:string,manageAccess=false){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const database=getDatabase();const actor=(await database.pool.query<{id:string}>(
  `select id from public.users where auth_user_id=$1 and status='active' limit 1`,[data.user.id])).rows[0];
 if(!actor)redirect("/dashboard/dashboards?status=forbidden");
 if(manageAccess&&!canManageDashboardAccess(project.role))
  redirect(`/dashboard/dashboards?id=${dashboardId??""}&status=forbidden`);
 if(!manageAccess&&!roles.has(project.role))redirect("/dashboard/dashboards?status=forbidden");
 if(dashboardId&&!canManageDashboardAccess(project.role)){
  const permission=(await database.pool.query<{access_level:"view"|"edit"|null;has_acl:boolean}>(
   `select (select access.access_level from public.dashboard_access access
      join public.memberships membership on membership.id=access.membership_id
      where access.dashboard_id=dashboard.id and membership.user_id=$2
       and membership.organization_id=$3 limit 1) access_level,
     exists(select 1 from public.dashboard_access access where access.dashboard_id=dashboard.id) has_acl
    from public.dashboards dashboard where dashboard.id=$1 and dashboard.project_id=$4
     and dashboard.status='active'`,[dashboardId,actor.id,project.organization_id,project.id])).rows[0];
  if(!permission||!canEditDashboard(project.role,permission.access_level,permission.has_acl))
   redirect(`/dashboard/dashboards?id=${dashboardId}&status=forbidden`);
 }
 return {database,project,actor};
}
export async function createDashboard(formData:FormData){
 const name=String(formData.get("name")??"").trim(),description=String(formData.get("description")??"").trim();
 const period=Number(formData.get("period_days")??30);
 if(name.length<2||name.length>120||![7,30,90,365].includes(period))redirect("/dashboard/dashboards?status=invalid");
 const {database,project,actor}=await scope(),client=await database.pool.connect();let id="";
 try{await client.query("begin");const row=(await client.query<{id:string}>(`insert into public.dashboards(
  organization_id,project_id,name,description,default_period_days,created_by_user_id)
  values($1,$2,$3,$4,$5,$6) returning id`,[project.organization_id,project.id,name,description||null,period,actor.id])).rows[0];
  if(!row)throw new Error("missing");id=row.id;
  const version=(await client.query<{id:string}>(`insert into public.dashboard_versions(organization_id,
   project_id,dashboard_id,version_number,status,title,description,global_filters,created_by_user_id)
   values($1,$2,$3,1,'draft',$4,$5,$6::jsonb,$7) returning id`,
   [project.organization_id,project.id,id,name,description||null,JSON.stringify({periodDays:period}),actor.id])).rows[0];
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'dashboard_created','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({name,period,draftVersionId:version?.id})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/dashboards?status=create-failed")}finally{client.release()}
 revalidatePath("/dashboard/dashboards");redirect(`/dashboard/dashboards?id=${id}&status=created`);
}
export async function addDashboardWidget(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),type=String(formData.get("widget_type")??"");
 const metric=String(formData.get("metric_key")??""),title=String(formData.get("title")??"").trim();
 if(!/^[0-9a-f-]{36}$/i.test(id)||!widgetTypes.has(type)||title.length<2||title.length>120
  ||(type!=="note"&&!getDashboardMetric(metric)))redirect(`/dashboard/dashboards?id=${id}&status=widget-invalid`);
 const {database,project,actor}=await scope(id),client=await database.pool.connect();
 try{await client.query("begin");const draft=(await client.query<{id:string}>(`select version.id
  from public.dashboard_versions version join public.dashboards dashboard on dashboard.id=version.dashboard_id
  where version.dashboard_id=$1 and version.project_id=$2 and dashboard.status='active'
   and version.status='draft' for update`,[id,project.id])).rows[0];if(!draft)throw new Error("draft");
  const order=(await client.query<{next:number}>(`select coalesce(max(display_order),-1)+1 next
   from public.dashboard_widgets where dashboard_version_id=$1`,[draft.id])).rows[0]?.next??0;
  const widget=(await client.query<{id:string}>(`insert into public.dashboard_widgets(organization_id,project_id,
   dashboard_version_id,widget_type,title,metric_key,display_order,grid_y)
   values($1,$2,$3,$4::public.dashboard_widget_type,$5,$6,$7,$7*3) returning id`,
   [project.organization_id,project.id,draft.id,type,title,type==="note"?null:metric,order])).rows[0];
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'dashboard_widget_created','dashboard_widget',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,widget?.id,JSON.stringify({dashboardId:id,type,metric,title})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&status=widget-failed`)}
 finally{client.release()}revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=widget-created`);
}
export async function updateDashboardWidget(formData:FormData){
 const dashboardId=String(formData.get("dashboard_id")??""),widgetId=String(formData.get("widget_id")??"");
 const title=String(formData.get("title")??"").trim(),type=String(formData.get("widget_type")??"");
 const metric=String(formData.get("metric_key")??"");
 if(!/^[0-9a-f-]{36}$/i.test(dashboardId)||!/^[0-9a-f-]{36}$/i.test(widgetId)
  ||title.length<2||title.length>120||!widgetTypes.has(type)||(type!=="note"&&!getDashboardMetric(metric)))
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-invalid`);
 const {database,project,actor}=await scope(dashboardId),client=await database.pool.connect();
 try{await client.query("begin");
  const before=(await client.query<{title:string;widget_type:string;metric_key:string|null}>(`
   select widget.title,widget.widget_type::text,widget.metric_key from public.dashboard_widgets widget
   join public.dashboard_versions version on version.id=widget.dashboard_version_id
   where widget.id=$1 and version.dashboard_id=$2 and widget.project_id=$3 and version.status='draft'
   for update`,[widgetId,dashboardId,project.id])).rows[0];
  if(!before)throw new Error("widget");
  await client.query(`update public.dashboard_widgets set title=$2,widget_type=$3::public.dashboard_widget_type,
   metric_key=$4,updated_at=now() where id=$1`,[widgetId,title,type,type==="note"?null:metric]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,before,after) values($1,$2,$3,'dashboard_widget_updated','dashboard_widget',
   $4,$5::jsonb,$6::jsonb)`,[project.organization_id,project.id,actor.id,widgetId,
    JSON.stringify(before),JSON.stringify({title,type,metric:type==="note"?null:metric,dashboardId})]);
  await client.query("commit");
 }catch{await client.query("rollback");
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-update-failed`)
 }finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-updated`);
}

export async function duplicateDashboardWidget(formData:FormData){
 const dashboardId=String(formData.get("dashboard_id")??""),widgetId=String(formData.get("widget_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(dashboardId)||!/^[0-9a-f-]{36}$/i.test(widgetId))
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-invalid`);
 const {database,project,actor}=await scope(dashboardId),client=await database.pool.connect();
 try{await client.query("begin");
  const source=(await client.query<{dashboard_version_id:string}>(`select widget.dashboard_version_id
   from public.dashboard_widgets widget join public.dashboard_versions version on version.id=widget.dashboard_version_id
   where widget.id=$1 and version.dashboard_id=$2 and widget.project_id=$3 and version.status='draft' for update`,
   [widgetId,dashboardId,project.id])).rows[0];if(!source)throw new Error("widget");
  const order=(await client.query<{next:number}>(`select coalesce(max(display_order),-1)+1 next
   from public.dashboard_widgets where dashboard_version_id=$1`,[source.dashboard_version_id])).rows[0]?.next??0;
  const copy=(await client.query<{id:string}>(`insert into public.dashboard_widgets(organization_id,project_id,
   dashboard_version_id,widget_type,title,metric_key,config,grid_x,grid_y,grid_width,grid_height,display_order)
   select organization_id,project_id,dashboard_version_id,widget_type,left(title||' — cópia',120),metric_key,
   config,grid_x,$3*3,grid_width,grid_height,$3 from public.dashboard_widgets where id=$1
   and dashboard_version_id=$2 returning id`,[widgetId,source.dashboard_version_id,order])).rows[0];
  if(!copy)throw new Error("copy");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,after) values($1,$2,$3,'dashboard_widget_duplicated','dashboard_widget',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,copy.id,JSON.stringify({dashboardId,sourceWidgetId:widgetId})]);
  await client.query("commit");
 }catch{await client.query("rollback");
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-duplicate-failed`)
 }finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-duplicated`);
}

export async function removeDashboardWidget(formData:FormData){
 const dashboardId=String(formData.get("dashboard_id")??""),widgetId=String(formData.get("widget_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(dashboardId)||!/^[0-9a-f-]{36}$/i.test(widgetId))
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-invalid`);
 const {database,project,actor}=await scope(dashboardId),client=await database.pool.connect();
 try{await client.query("begin");
  const removed=(await client.query<{title:string;widget_type:string;metric_key:string|null}>(`
   delete from public.dashboard_widgets widget using public.dashboard_versions version
   where widget.id=$1 and widget.dashboard_version_id=version.id and version.dashboard_id=$2
    and widget.project_id=$3 and version.status='draft'
   returning widget.title,widget.widget_type::text,widget.metric_key`,[widgetId,dashboardId,project.id])).rows[0];
  if(!removed)throw new Error("widget");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,before) values($1,$2,$3,'dashboard_widget_removed','dashboard_widget',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,widgetId,JSON.stringify({...removed,dashboardId})]);
  await client.query("commit");
 }catch{await client.query("rollback");
  redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-remove-failed`)
 }finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${dashboardId}&mode=edit&status=widget-removed`);
}

export async function publishDashboard(formData:FormData){
 const id=String(formData.get("dashboard_id")??"");if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/dashboards?status=invalid");
 const {database,project,actor}=await scope(id),client=await database.pool.connect();
 try{await client.query("begin");const draft=(await client.query<{id:string;version_number:number}>(
  `select id,version_number from public.dashboard_versions where dashboard_id=$1 and project_id=$2
   and status='draft' for update`,[id,project.id])).rows[0];if(!draft)throw new Error("draft");
  await client.query(`update public.dashboard_versions set status='published',published_by_user_id=$3,
   published_at=now(),updated_at=now() where id=$1 and project_id=$2`,[draft.id,project.id,actor.id]);
  const next=(await client.query<{id:string}>(`insert into public.dashboard_versions(organization_id,project_id,
   dashboard_id,version_number,status,title,description,global_filters,created_by_user_id)
   select organization_id,project_id,dashboard_id,$3,'draft',title,description,global_filters,$4
   from public.dashboard_versions where id=$1 and project_id=$2 returning id`,
   [draft.id,project.id,draft.version_number+1,actor.id])).rows[0];if(!next)throw new Error("next");
  await client.query(`insert into public.dashboard_widgets(organization_id,project_id,dashboard_version_id,
   widget_type,title,metric_key,config,grid_x,grid_y,grid_width,grid_height,display_order)
   select organization_id,project_id,$2,widget_type,title,metric_key,config,grid_x,grid_y,grid_width,
   grid_height,display_order from public.dashboard_widgets where dashboard_version_id=$1`,[draft.id,next.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,after) values($1,$2,$3,'dashboard_published','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({version:draft.version_number})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&status=publish-failed`)}
 finally{client.release()}revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&status=published`);
}
export async function archiveDashboard(formData:FormData){
 const id=String(formData.get("dashboard_id")??"");if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/dashboards?status=invalid");
 const {database,project,actor}=await scope(id);const changed=await database.pool.query(`update public.dashboards
  set status='archived',archived_by_user_id=$3,archived_at=now(),updated_at=now()
  where id=$1 and project_id=$2 and status='active'`,[id,project.id,actor.id]);
 if(!changed.rowCount)redirect(`/dashboard/dashboards?id=${id}&status=archive-failed`);
 await database.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'dashboard_archived','dashboard',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,id,JSON.stringify({status:"archived"})]);
 revalidatePath("/dashboard/dashboards");redirect("/dashboard/dashboards?status=archived");
}

export async function saveDashboardLayout(formData:FormData){
 const id=String(formData.get("dashboard_id")??"");let layout:unknown;
 try{layout=JSON.parse(String(formData.get("layout")??""))}catch{layout=null}
 if(!/^[0-9a-f-]{36}$/i.test(id)||!Array.isArray(layout)||layout.length>100)
  redirect(`/dashboard/dashboards?id=${id}&status=layout-invalid`);
 const rows=layout.map((item)=>{
  if(!item||typeof item!=="object")return null;const value=item as Record<string,unknown>;
  const row={id:String(value.id??""),displayOrder:Number(value.displayOrder),gridWidth:Number(value.gridWidth),
   gridHeight:Number(value.gridHeight),gridX:Number(value.gridX),gridY:Number(value.gridY)};
  return /^[0-9a-f-]{36}$/i.test(row.id)&&Number.isInteger(row.displayOrder)&&row.displayOrder>=0
   &&Number.isInteger(row.gridWidth)&&row.gridWidth>=1&&row.gridWidth<=12
   &&Number.isInteger(row.gridHeight)&&row.gridHeight>=1&&row.gridHeight<=20
   &&Number.isInteger(row.gridX)&&row.gridX>=0&&row.gridX<=11
   &&Number.isInteger(row.gridY)&&row.gridY>=0?row:null;
 });
 if(rows.some(row=>!row)||new Set(rows.map(row=>row?.id)).size!==rows.length)
  redirect(`/dashboard/dashboards?id=${id}&status=layout-invalid`);
 const {database,project,actor}=await scope(id),client=await database.pool.connect();
 try{await client.query("begin");const draft=(await client.query<{id:string}>(`select id from
  public.dashboard_versions where dashboard_id=$1 and project_id=$2 and status='draft' for update`,
  [id,project.id])).rows[0];if(!draft)throw new Error("draft");
  const existing=(await client.query<{id:string}>(`select id from public.dashboard_widgets
   where dashboard_version_id=$1`,[draft.id])).rows.map(row=>row.id);
  if(existing.length!==rows.length||existing.some(widgetId=>!rows.some(row=>row?.id===widgetId)))
   throw new Error("scope");
  for(const row of rows){if(!row)continue;await client.query(`update public.dashboard_widgets set
   display_order=$3,grid_width=$4,grid_height=$5,grid_x=$6,grid_y=$7,updated_at=now()
   where id=$1 and dashboard_version_id=$2`,[row.id,draft.id,row.displayOrder,row.gridWidth,
    row.gridHeight,row.gridX,row.gridY]);}
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'dashboard_layout_updated','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({widgetCount:rows.length})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&status=layout-failed`)}
 finally{client.release()}revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=layout-saved`);
}

export async function updateDashboardPeriod(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),period=Number(formData.get("period_days"));
 if(!/^[0-9a-f-]{36}$/i.test(id)||![7,30,90,365].includes(period))
  redirect(`/dashboard/dashboards?id=${id}&status=period-invalid`);
 const {database,project,actor}=await scope(id);const changed=await database.pool.query(`update public.dashboard_versions
  set global_filters=coalesce(global_filters,'{}'::jsonb)||$3::jsonb,updated_at=now()
  where dashboard_id=$1 and project_id=$2 and status='draft'`,
  [id,project.id,JSON.stringify({periodDays:period})]);
 if(!changed.rowCount)redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=period-failed`);
 await database.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'dashboard_filters_updated','dashboard',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,id,JSON.stringify({periodDays:period})]);
 revalidatePath("/dashboard/dashboards");redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=period-saved`);
}

export async function createDashboardFromTemplate(formData:FormData){
 const template=getDashboardTemplate(String(formData.get("template")??""));
 if(!template)redirect("/dashboard/dashboards?status=template-invalid");
 const {database,project,actor}=await scope(),client=await database.pool.connect();let id="";
 try{await client.query("begin");const dashboard=(await client.query<{id:string}>(`insert into public.dashboards(
  organization_id,project_id,name,description,default_period_days,created_by_user_id)
  values($1,$2,$3,$4,30,$5) returning id`,
  [project.organization_id,project.id,template.name,template.description,actor.id])).rows[0];
  if(!dashboard)throw new Error("dashboard");id=dashboard.id;
  const version=(await client.query<{id:string}>(`insert into public.dashboard_versions(organization_id,
   project_id,dashboard_id,version_number,status,title,description,global_filters,created_by_user_id)
   values($1,$2,$3,1,'draft',$4,$5,'{"periodDays":30}'::jsonb,$6) returning id`,
   [project.organization_id,project.id,id,template.name,template.description,actor.id])).rows[0];
  if(!version)throw new Error("version");
  for(const [index,widget] of template.widgets.entries())await client.query(`insert into public.dashboard_widgets(
   organization_id,project_id,dashboard_version_id,widget_type,title,metric_key,grid_width,grid_y,display_order)
   values($1,$2,$3,$4::public.dashboard_widget_type,$5,$6,$7,$8,$9)`,
   [project.organization_id,project.id,version.id,widget.type,widget.title,widget.metric,widget.width,index*3,index]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,after) values($1,$2,$3,'dashboard_created_from_template','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({template:template.key,widgets:template.widgets.length})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/dashboards?status=template-failed")}
 finally{client.release()}revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&status=template-created`);
}

export async function createDashboardWithAi(formData:FormData){
 const prompt=String(formData.get("prompt")??"").trim();
 if(prompt.length<10||prompt.length>1000)redirect("/dashboard/dashboards?status=ai-invalid");
 const {database,project,actor}=await scope();let result:Awaited<ReturnType<typeof proposeDashboard>>;
 try{result=await proposeDashboard(database,project.id,prompt)}
 catch(error){const code=error instanceof Error?error.message:"";
  redirect(`/dashboard/dashboards?status=${code==="dashboard_ai_budget"?"ai-budget":"ai-failed"}`)}
 const {proposal,model,usage}=result,client=await database.pool.connect();let id="";
 try{await client.query("begin");
  const dashboard=(await client.query<{id:string}>(`insert into public.dashboards(
   organization_id,project_id,name,description,default_period_days,created_by_user_id)
   values($1,$2,$3,$4,$5,$6) returning id`,
   [project.organization_id,project.id,proposal.title,proposal.description||null,proposal.periodDays,actor.id])).rows[0];
  if(!dashboard)throw new Error("dashboard");id=dashboard.id;
  const version=(await client.query<{id:string}>(`insert into public.dashboard_versions(organization_id,
   project_id,dashboard_id,version_number,status,title,description,global_filters,created_by_user_id)
   values($1,$2,$3,1,'draft',$4,$5,$6::jsonb,$7) returning id`,
   [project.organization_id,project.id,id,proposal.title,proposal.description||null,
    JSON.stringify({periodDays:proposal.periodDays}),actor.id])).rows[0];
  if(!version)throw new Error("version");
  for(const [index,widget] of proposal.widgets.entries())await client.query(`insert into public.dashboard_widgets(
   organization_id,project_id,dashboard_version_id,widget_type,title,metric_key,grid_width,grid_y,display_order)
   values($1,$2,$3,$4::public.dashboard_widget_type,$5,$6,$7,$8,$9)`,
   [project.organization_id,project.id,version.id,widget.type,widget.title,widget.metric,widget.width,index*3,index]);
  const pricing=(await client.query<{input_cost_per_million_brl:string|null;output_cost_per_million_brl:string|null;
   id:string}>(`select id,input_cost_per_million_brl,output_cost_per_million_brl
   from public.ai_project_pricing_versions where project_id=$1 and model=$2 and operation='creative_analysis'
   and valid_from<=now() and (valid_until is null or valid_until>now()) order by valid_from desc limit 1`,
   [project.id,model])).rows[0];
  const inputTokens=usage.input_tokens??null,outputTokens=usage.output_tokens??null;
  const estimatedCost=pricing&&inputTokens!==null&&outputTokens!==null
   ?inputTokens/1_000_000*Number(pricing.input_cost_per_million_brl??0)
    +outputTokens/1_000_000*Number(pricing.output_cost_per_million_brl??0):null;
  await client.query(`insert into public.dashboard_ai_requests(organization_id,project_id,dashboard_id,
   requested_by_user_id,model,prompt,proposal,input_tokens,output_tokens,total_tokens,estimated_cost_brl)
   values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
   [project.organization_id,project.id,id,actor.id,model,prompt,JSON.stringify(proposal),
    inputTokens,outputTokens,usage.total_tokens??null,estimatedCost]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,after) values($1,$2,$3,'dashboard_created_with_ai','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({model,widgets:proposal.widgets.length,
    published:false})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/dashboards?status=ai-save-failed")}
 finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=ai-created`);
}

export async function restoreDashboardVersion(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),versionId=String(formData.get("version_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(versionId))
  redirect(`/dashboard/dashboards?id=${id}&status=restore-invalid`);
 const {database,project,actor}=await scope(id),client=await database.pool.connect();
 try{await client.query("begin");const source=(await client.query<{id:string;version_number:number;
  title:string;description:string|null;global_filters:unknown}>(`select id,version_number,title,description,
   global_filters from public.dashboard_versions where id=$1 and dashboard_id=$2 and project_id=$3
   and status='published'`,[versionId,id,project.id])).rows[0];
  const draft=(await client.query<{id:string}>(`select id from public.dashboard_versions where
   dashboard_id=$1 and project_id=$2 and status='draft' for update`,[id,project.id])).rows[0];
  if(!source||!draft)throw new Error("version");
  await client.query(`delete from public.dashboard_widgets where dashboard_version_id=$1`,[draft.id]);
  await client.query(`update public.dashboard_versions set title=$2,description=$3,global_filters=$4::jsonb,
   updated_at=now() where id=$1`,[draft.id,source.title,source.description,JSON.stringify(source.global_filters)]);
  await client.query(`insert into public.dashboard_widgets(organization_id,project_id,dashboard_version_id,
   widget_type,title,metric_key,config,grid_x,grid_y,grid_width,grid_height,display_order)
   select organization_id,project_id,$2,widget_type,title,metric_key,config,grid_x,grid_y,grid_width,
   grid_height,display_order from public.dashboard_widgets where dashboard_version_id=$1`,[source.id,draft.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,after) values($1,$2,$3,'dashboard_version_restored','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({sourceVersionId:source.id,
    sourceVersionNumber:source.version_number,targetDraftId:draft.id})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&status=restore-failed`)}
 finally{client.release()}revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=restored`);
}

export async function updateDashboardFilters(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),productId=String(formData.get("product_id")??"")||null;
 const accountId=String(formData.get("account_id")??"")||null,campaignId=String(formData.get("campaign_id")??"")||null;
 const valid=(value:string|null)=>!value||/^[0-9a-f-]{36}$/i.test(value);
 if(!/^[0-9a-f-]{36}$/i.test(id)||![productId,accountId,campaignId].every(valid))
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-invalid`);
 const {database,project,actor}=await scope(id);
 if(productId&&!(await database.pool.query(`select 1 from public.commerce_products
  where id=$1 and project_id=$2`,[productId,project.id])).rowCount)
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-forbidden`);
 if(accountId&&!(await database.pool.query(`select 1 from public.meta_ad_accounts
  where id=$1 and project_id=$2`,[accountId,project.id])).rowCount)
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-forbidden`);
 if(campaignId&&!(await database.pool.query(`select 1 from public.meta_campaigns
  where id=$1 and project_id=$2 and ($3::uuid is null or meta_ad_account_id=$3)`,
  [campaignId,project.id,accountId])).rowCount)
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-forbidden`);
 const filters={productId,accountId,campaignId};
 const changed=await database.pool.query(`update public.dashboard_versions set global_filters=
  coalesce(global_filters,'{}'::jsonb)||$3::jsonb,updated_at=now()
  where dashboard_id=$1 and project_id=$2 and status='draft'`,[id,project.id,JSON.stringify(filters)]);
 if(!changed.rowCount)redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-failed`);
 await database.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,after) values($1,$2,$3,'dashboard_filters_updated','dashboard',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,id,JSON.stringify(filters)]);
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=filters-saved`);
}

export async function grantDashboardAccess(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),membershipId=String(formData.get("membership_id")??"");
 const accessLevel=String(formData.get("access_level")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(membershipId)
  ||!["view","edit"].includes(accessLevel))
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-invalid`);
 const {database,project,actor}=await scope(id,true),client=await database.pool.connect();
 try{await client.query("begin");
  const eligible=(await client.query(`select 1 from public.memberships membership
   where membership.id=$1 and membership.organization_id=$2
   and (not exists(select 1 from public.project_memberships restricted where restricted.membership_id=membership.id)
    or exists(select 1 from public.project_memberships allowed where allowed.membership_id=membership.id
     and allowed.project_id=$3))`,[membershipId,project.organization_id,project.id])).rowCount;
  const dashboard=(await client.query(`select 1 from public.dashboards where id=$1 and project_id=$2
   and status='active'`,[id,project.id])).rowCount;
  if(!eligible||!dashboard)throw new Error("scope");
  const before=(await client.query<{access_level:string}>(`select access_level from public.dashboard_access
   where dashboard_id=$1 and membership_id=$2`,[id,membershipId])).rows[0]??null;
  await client.query(`insert into public.dashboard_access(dashboard_id,membership_id,access_level,granted_by_user_id)
   values($1,$2,$3,$4) on conflict(dashboard_id,membership_id) do update set
   access_level=excluded.access_level,granted_by_user_id=excluded.granted_by_user_id,created_at=now()`,
   [id,membershipId,accessLevel,actor.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,before,after) values($1,$2,$3,'dashboard_access_granted','dashboard',$4,$5::jsonb,$6::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify(before),
    JSON.stringify({membershipId,accessLevel})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-failed`)}
 finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-saved`);
}

export async function revokeDashboardAccess(formData:FormData){
 const id=String(formData.get("dashboard_id")??""),membershipId=String(formData.get("membership_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(membershipId))
  redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-invalid`);
 const {database,project,actor}=await scope(id,true),client=await database.pool.connect();
 try{await client.query("begin");
  const removed=(await client.query<{access_level:string}>(`delete from public.dashboard_access access
   using public.dashboards dashboard where access.dashboard_id=dashboard.id and access.dashboard_id=$1
   and access.membership_id=$2 and dashboard.project_id=$3 returning access.access_level`,
   [id,membershipId,project.id])).rows[0];
  if(!removed)throw new Error("missing");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
   target_type,target_id,before) values($1,$2,$3,'dashboard_access_revoked','dashboard',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,id,JSON.stringify({membershipId,accessLevel:removed.access_level})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-failed`)}
 finally{client.release()}
 revalidatePath("/dashboard/dashboards");
 redirect(`/dashboard/dashboards?id=${id}&mode=edit&status=access-revoked`);
}
