"use server";

import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getActiveProject} from "../../lib/active-project";
import {getDatabase} from "../../lib/database";
import {createClient} from "../../lib/supabase/server";
import {queueQuickMetaSync,waitForMetaSyncRuns} from "../../lib/meta-sync-queue";

const marker="[funil-metrics:dashboard-v2]";
const allowedKinds=new Set([
 "kpi_revenue","kpi_net_revenue","kpi_ticket","kpi_cpa","kpi_spend","kpi_profit","kpi_roas","financial_health","financial_chart",
 "product_sales","account_spend","channel_sales","hour_sales","conversion_funnel",
 "region_sales","ad_performance","recent_sales",
 "product_sales_donut","payment_method_sales","payment_method_approval","sales_table",
]);
const granularities=new Set(["daily","weekly","monthly"]),comparisons=new Set(["previous","none"]),chartTypes=new Set(["composed","bars","lines"]),sorts=new Set(["desc","asc"]);
const governedMetrics=new Set(["meta_impressions","meta_link_clicks","meta_landing_page_views","meta_view_content","meta_add_to_cart","meta_initiate_checkout","pending_payments","approved_payments","gross_revenue"]);
type WidgetConfig={title?:string;description?:string;granularity?:string;comparison?:string;metrics?:string[];legend?:boolean;tooltip?:boolean;chartType?:string;sort?:string;limit?:number;primaryColor?:string;secondaryColor?:string};
type LayoutRow={id:string;kind:string;displayOrder:number;gridWidth:number;gridHeight:number;gridX:number;gridY:number;config:WidgetConfig};

function sanitizeConfig(value:unknown):WidgetConfig{
 const source=value&&typeof value==="object"?value as Record<string,unknown>:{};
 const title=String(source.title??"").trim().slice(0,120);
 const description=String(source.description??"").trim().slice(0,240),color=(value:unknown)=>/^#[0-9a-f]{6}$/i.test(String(value))?String(value):undefined;
 const metrics=Array.isArray(source.metrics)?source.metrics.map(String).filter(metric=>governedMetrics.has(metric)).slice(0,10):[];
 return {...(title.length>=2?{title}:{}),...(description?{description}:{}),...(granularities.has(String(source.granularity))?{granularity:String(source.granularity)}:{}),
  ...(comparisons.has(String(source.comparison))?{comparison:String(source.comparison)}:{}),...(metrics.length?{metrics}:{}),
  ...(typeof source.legend==="boolean"?{legend:source.legend}:{}),...(typeof source.tooltip==="boolean"?{tooltip:source.tooltip}:{}),
  ...(chartTypes.has(String(source.chartType))?{chartType:String(source.chartType)}:{}),...(sorts.has(String(source.sort))?{sort:String(source.sort)}:{}),
  ...(Number.isInteger(Number(source.limit))?{limit:Math.min(20,Math.max(1,Number(source.limit)))}:{}),...(color(source.primaryColor)?{primaryColor:color(source.primaryColor)}:{}),...(color(source.secondaryColor)?{secondaryColor:color(source.secondaryColor)}:{})};
}

function parseLayout(value:FormDataEntryValue|null):LayoutRow[]|null{
 let raw:unknown;
 try{raw=JSON.parse(String(value??""))}catch{return null}
 if(!Array.isArray(raw)||raw.length>24)return null;
 const rows=raw.map((item,index)=>{
  if(!item||typeof item!=="object")return null;
  const source=item as Record<string,unknown>,row={id:String(source.id??source.kind??""),kind:String(source.kind??""),displayOrder:index,
   gridWidth:Number(source.gridWidth),gridHeight:Number(source.gridHeight),gridX:Number(source.gridX),gridY:Number(source.gridY),config:sanitizeConfig(source.config)};
  return /^[a-z0-9_-]{3,100}$/.test(row.id)&&allowedKinds.has(row.kind)&&Number.isInteger(row.gridWidth)&&row.gridWidth>=1&&row.gridWidth<=12
   &&Number.isInteger(row.gridHeight)&&row.gridHeight>=1&&row.gridHeight<=20
   &&Number.isInteger(row.gridX)&&row.gridX>=0&&row.gridX<=11
   &&Number.isInteger(row.gridY)&&row.gridY>=0?row:null;
 });
 if(rows.some(row=>!row)||new Set(rows.map(row=>row?.id)).size!==rows.length)return null;
 return rows as LayoutRow[];
}

export async function saveDashboardV2Layout(formData:FormData){
 const rows=parseLayout(formData.get("layout"));if(!rows)redirect("/dashboard-v2?status=layout-invalid");
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 if(!new Set(["owner","administrator","editor"]).has(project.role))redirect("/dashboard-v2?status=forbidden");
 const database=getDatabase(),client=await database.pool.connect();
 try{
  await client.query("begin");await client.query("select pg_advisory_xact_lock(hashtext($1))",[`dashboard-v2:${project.id}`]);
  const actor=(await client.query<{id:string}>(`select id from public.users where auth_user_id=$1 and status='active' limit 1`,[data.user.id])).rows[0];
  if(!actor)throw new Error("actor");
  let dashboard=(await client.query<{id:string}>(`select id from public.dashboards where project_id=$1 and status='active' and description=$2 order by created_at limit 1`,[project.id,marker])).rows[0];
  if(!dashboard){dashboard=(await client.query<{id:string}>(`insert into public.dashboards(organization_id,project_id,name,description,default_period_days,created_by_user_id) values($1,$2,'Visão geral',$3,30,$4) returning id`,[project.organization_id,project.id,marker,actor.id])).rows[0];}
  if(!dashboard)throw new Error("dashboard");
  let draft=(await client.query<{id:string}>(`select id from public.dashboard_versions where dashboard_id=$1 and status='draft' for update`,[dashboard.id])).rows[0];
  if(!draft){const next=(await client.query<{next:number}>(`select coalesce(max(version_number),0)+1 next from public.dashboard_versions where dashboard_id=$1`,[dashboard.id])).rows[0]?.next??1;draft=(await client.query<{id:string}>(`insert into public.dashboard_versions(organization_id,project_id,dashboard_id,version_number,status,title,description,global_filters,created_by_user_id) values($1,$2,$3,$4,'draft','Visão geral',$5,'{}'::jsonb,$6) returning id`,[project.organization_id,project.id,dashboard.id,next,marker,actor.id])).rows[0];}
  if(!draft)throw new Error("draft");
  const existing=(await client.query<{id:string;instance_id:string}>(`select id,coalesce(config->>'v2InstanceId',config->>'v2Kind') instance_id from public.dashboard_widgets where dashboard_version_id=$1`,[draft.id])).rows;
  for(const widget of existing)if(!rows.some(row=>row.id===widget.instance_id))await client.query(`delete from public.dashboard_widgets where id=$1 and dashboard_version_id=$2`,[widget.id,draft.id]);
  for(const row of rows){const definition={v2Kind:row.kind,v2InstanceId:row.id,...row.config},title=row.config.title??row.kind;const found=existing.find(widget=>widget.instance_id===row.id);if(found)await client.query(`update public.dashboard_widgets set title=$3,config=$4::jsonb,grid_x=$5,grid_y=$6,grid_width=$7,grid_height=$8,display_order=$9,updated_at=now() where id=$1 and dashboard_version_id=$2`,[found.id,draft.id,title,JSON.stringify(definition),row.gridX,row.gridY,row.gridWidth,row.gridHeight,row.displayOrder]);else await client.query(`insert into public.dashboard_widgets(organization_id,project_id,dashboard_version_id,widget_type,title,metric_key,config,grid_x,grid_y,grid_width,grid_height,display_order) values($1,$2,$3,'note',$4,null,$5::jsonb,$6,$7,$8,$9,$10)`,[project.organization_id,project.id,draft.id,title,JSON.stringify(definition),row.gridX,row.gridY,row.gridWidth,row.gridHeight,row.displayOrder]);}
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after) values($1,$2,$3,'dashboard_v2_layout_updated','dashboard',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,dashboard.id,JSON.stringify({widgets:rows.map(row=>({id:row.id,kind:row.kind})),configurationVersion:1})]);
  await client.query("commit");
 }catch(error){await client.query("rollback");console.error("dashboard_v2_layout_save_failed",error);redirect("/dashboard-v2?status=layout-failed")}finally{client.release()}
 revalidatePath("/dashboard-v2");
}

export async function saveDashboardV2Template(formData:FormData){
 const name=String(formData.get("name")??"").trim().replace(/\s+/g," ").slice(0,120);
 const rows=parseLayout(formData.get("layout"));
 if(name.length<2)return {ok:false as const,message:"Informe um nome com pelo menos 2 caracteres."};
 if(!rows)return {ok:false as const,message:"O layout atual nao e valido para ser salvo como template."};
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project)return {ok:false as const,message:"Selecione um projeto antes de salvar o template."};
 if(!new Set(["owner","administrator","editor"]).has(project.role))return {ok:false as const,message:"Seu perfil nao possui permissao para criar templates."};
 const database=getDatabase(),client=await database.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string}>(`select id from public.users where auth_user_id=$1 and status='active' limit 1`,[data.user.id])).rows[0];
  if(!actor)throw new Error("actor");
  const duplicate=(await client.query<{id:string}>(`select id from public.dashboard_templates where project_id=$1 and not is_system and lower(name)=lower($2) limit 1`,[project.id,name])).rows[0];
  if(duplicate){await client.query("rollback");return {ok:false as const,message:"Ja existe um template com esse nome neste projeto."};}
  const definition={version:1,source:"dashboard-v2",widgets:rows};
  const saved=(await client.query<{id:string;createdAt:string}>(`insert into public.dashboard_templates(
   organization_id,project_id,name,description,definition,is_system,created_by_user_id)
   values($1,$2,$3,$4,$5::jsonb,false,$6) returning id,created_at::text "createdAt"`,
  [project.organization_id,project.id,name,"Layout personalizado do Dashboard V2",JSON.stringify(definition),actor.id])).rows[0];
  if(!saved)throw new Error("template");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after)
   values($1,$2,$3,'dashboard_template_created','dashboard_template',$4,$5::jsonb)`,
  [project.organization_id,project.id,actor.id,saved.id,JSON.stringify({name,widgetCount:rows.length,definitionVersion:1})]);
  await client.query("commit");
  revalidatePath("/dashboard-v2");
  return {ok:true as const,message:"Template salvo com sucesso.",template:{id:saved.id,name,definition,createdAt:saved.createdAt}};
 }catch(error){await client.query("rollback");console.error("dashboard_v2_template_save_failed",error);return {ok:false as const,message:"Nao foi possivel salvar o template. Tente novamente."};}
 finally{client.release()}
}

export async function queueDashboardMetaSync(formData:FormData){
 const returnTo=String(formData.get("return_to")??"/dashboard-v2");
 const safeReturn=returnTo.startsWith("/dashboard-v2")?returnTo:"/dashboard-v2";
 const suffix=safeReturn.includes("?")?"&":"?";
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 if(!new Set(["owner","administrator"]).has(project.role))redirect(`${safeReturn}${suffix}status=meta-sync-forbidden`);
 const force=String(formData.get("refresh")??"")==="1";
 const database=getDatabase();
 const runIds=await queueQuickMetaSync(database.pool,{organizationId:project.organization_id,projectId:project.id,authUserId:data.user.id,force}).catch(()=>[] as string[]);
 if(force)await waitForMetaSyncRuns(database.pool,runIds).catch(()=>undefined);
 revalidatePath("/dashboard-v2");
 redirect(`${safeReturn}${suffix}status=meta-sync-queued`);
}
