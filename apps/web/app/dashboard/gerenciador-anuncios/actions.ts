"use server";

import {createHash,randomUUID} from "node:crypto";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {createClient} from "../../../lib/supabase/server";
import {loadMetaConnectionAccessToken} from "../../../lib/meta-oauth";
import {desiredMetaStatus,metaDailyBudgetMatches,metaNameMatches,metaStateMatches,sanitizeMetaResponse} from "../../../lib/meta-manager-execution";
import {normalizeMetaManagerColumns} from "../../../lib/meta-manager-columns";

const levels=["accounts","campaigns","adsets","ads"] as const;

function safeReturnTo(value:FormDataEntryValue|null){
 const candidate=String(value??"");
 return candidate.startsWith("/dashboard/gerenciador-anuncios?")?candidate:"/dashboard/gerenciador-anuncios?level=campaigns";
}
function withStatus(returnTo:string,status:string){
 const separator=returnTo.includes("?")?"&":"?";
 return `${returnTo}${separator}notice=${encodeURIComponent(status)}`;
}

async function context(){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 return {authUserId:data.user.id,project,db:getDatabase()};
}

export async function saveManagerColumns(formData:FormData){
 const level=String(formData.get("level")??"");
 const returnTo=safeReturnTo(formData.get("return_to"));
 let selected:string[]=[];
 try{selected=JSON.parse(String(formData.get("columns")??"[]"));}catch{/* invalid input */}
 selected=normalizeMetaManagerColumns(selected);
 if(!levels.includes(level as typeof levels[number])||!selected.includes("name"))redirect(withStatus(returnTo,"invalid-columns"));
 const {authUserId,project,db}=await context();
 const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
 if(!actor)redirect(withStatus(returnTo,"forbidden"));
 const client=await db.pool.connect();
 try{await client.query("begin");
  await client.query(`insert into public.meta_manager_views(organization_id,project_id,user_id,level,columns)
   values($1,$2,$3,$4,$5::jsonb) on conflict(project_id,user_id,level) do update
   set columns=excluded.columns,updated_at=now()`,[project.organization_id,project.id,actor.id,level,JSON.stringify(selected)]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after)
   values($1,$2,$3,'meta_manager_columns_saved','meta_manager_view',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,`${actor.id}:${level}`,JSON.stringify({level,columns:selected})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(withStatus(returnTo,"save-failed"));}finally{client.release();}
 revalidatePath("/dashboard/gerenciador-anuncios");redirect(withStatus(returnTo,"columns-saved"));
}

export async function saveManagerFilters(formData:FormData){
 const level=String(formData.get("level")??"");
 if(!levels.includes(level as typeof levels[number]))redirect("/dashboard/gerenciador-anuncios?level=campaigns&notice=invalid-filters");
 const q=String(formData.get("q")??"").trim().slice(0,100);
 const rawAccount=String(formData.get("account")??"");
 const account=/^[0-9a-f-]{36}$/i.test(rawAccount)?rawAccount:"";
 const allowedStatuses=level==="accounts"?["1","2","3"]:["ACTIVE","PAUSED","ARCHIVED"];
 const rawStatus=String(formData.get("status")??"");
 const status=allowedStatuses.includes(rawStatus)?rawStatus:"";
 const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value:"";
 const from=validDate(String(formData.get("from")??"")),to=validDate(String(formData.get("to")??""));
 const filters={q,account,status,from,to};
 const {authUserId,project,db}=await context();
 const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
 if(!actor)redirect("/dashboard/gerenciador-anuncios?level=campaigns&notice=forbidden");
 const client=await db.pool.connect();
 try{await client.query("begin");
  await client.query(`insert into public.meta_manager_views(organization_id,project_id,user_id,level,filters)
   values($1,$2,$3,$4,$5::jsonb) on conflict(project_id,user_id,level) do update
   set filters=excluded.filters,updated_at=now()`,[project.organization_id,project.id,actor.id,level,JSON.stringify(filters)]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after)
   values($1,$2,$3,'meta_manager_filters_saved','meta_manager_view',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,`${actor.id}:${level}`,JSON.stringify({level,filters})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(`/dashboard/gerenciador-anuncios?level=${level}&notice=save-failed`);}finally{client.release();}
 const next=new URLSearchParams({level,from,to});
 if(q)next.set("q",q);if(account)next.set("account",account);if(status)next.set("status",status);
 revalidatePath("/dashboard/gerenciador-anuncios");redirect(`/dashboard/gerenciador-anuncios?${next}&notice=filters-saved`);
}

export async function requestManagerStatusChange(formData:FormData){
 const entityType=String(formData.get("entity_type")??"");
 const entityId=String(formData.get("entity_id")??"");
 const actionType=String(formData.get("action_type")??"");
 const reason=String(formData.get("reason")??"").trim().slice(0,1000);
 const returnTo=safeReturnTo(formData.get("return_to"));
 if(!["campaign","adset","ad"].includes(entityType)||!/^[0-9a-f-]{36}$/i.test(entityId)
  ||!["activate","pause"].includes(actionType)||reason.length<5)redirect(withStatus(returnTo,"invalid-action"));
 const {authUserId,project,db}=await context();
 if(!["owner","administrator","editor"].includes(project.role))redirect(withStatus(returnTo,"forbidden"));
 const config={campaign:{table:"meta_campaigns"},adset:{table:"meta_ad_sets"},ad:{table:"meta_ads"}}[entityType]!;
 const entity=(await db.pool.query<{id:string;external_id:string;name:string;status:string|null;effective_status:string|null}>(
  `select id,external_id,name,status,effective_status from public.${config.table} where id=$1 and project_id=$2`,[entityId,project.id])).rows[0];
 if(!entity)redirect(withStatus(returnTo,"not-found"));
 const desiredStatus=actionType==="activate"?"ACTIVE":"PAUSED";
 const idempotencyKey=createHash("sha256").update(`${project.id}:${entityType}:${entityId}:${desiredStatus}:${entity.status}:${entity.effective_status}`).digest("hex");
 const client=await db.pool.connect();
 try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
  if(!actor)throw new Error("actor_missing");
  const result=await client.query<{id:string}>(`insert into public.meta_manager_action_requests
   (organization_id,project_id,entity_type,entity_id,external_id,action_type,before_state,desired_state,reason,idempotency_key,requested_by_user_id)
   values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
   on conflict(project_id,idempotency_key) do update set updated_at=now() returning id`,
   [project.organization_id,project.id,entityType,entityId,entity.external_id,actionType,
    JSON.stringify({name:entity.name,status:entity.status,effectiveStatus:entity.effective_status}),
    JSON.stringify({status:desiredStatus}),reason,idempotencyKey,actor.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,before,after)
   values($1,$2,$3,'meta_manager_status_requested','meta_manager_action_request',$4,$5::jsonb,$6::jsonb)`,
   [project.organization_id,project.id,actor.id,result.rows[0]!.id,
    JSON.stringify({status:entity.status,effectiveStatus:entity.effective_status}),JSON.stringify({status:desiredStatus,reason})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(withStatus(returnTo,"request-failed"));}finally{client.release();}
 revalidatePath("/dashboard/gerenciador-anuncios");redirect(withStatus(returnTo,"requested"));
}

export async function requestBulkManagerStatusChange(formData:FormData){
 const entityType=String(formData.get("entity_type")??"");
 const actionType=String(formData.get("action_type")??"");
 const reason=String(formData.get("reason")??"").trim().slice(0,1000);
 const returnTo=safeReturnTo(formData.get("return_to"));
 let parsed:unknown=[];
 try{parsed=JSON.parse(String(formData.get("entity_ids")??"[]"));}catch{/* invalid input */}
 const entityIds=Array.isArray(parsed)?[...new Set(parsed.filter((value):value is string=>
  typeof value==="string"&&/^[0-9a-f-]{36}$/i.test(value)))].slice(0,100):[];
 if(!["campaign","adset","ad"].includes(entityType)||!["activate","pause"].includes(actionType)
  ||reason.length<5||entityIds.length===0)redirect(withStatus(returnTo,"invalid-action"));
 const {authUserId,project,db}=await context();
 if(!["owner","administrator","editor"].includes(project.role))redirect(withStatus(returnTo,"forbidden"));
 const table={campaign:"meta_campaigns",adset:"meta_ad_sets",ad:"meta_ads"}[entityType]!;
 const entities=(await db.pool.query<{id:string;external_id:string;name:string;status:string|null;effective_status:string|null}>(
  `select id,external_id,name,status,effective_status from public.${table} where project_id=$1 and id=any($2::uuid[])`,
  [project.id,entityIds])).rows;
 if(entities.length!==entityIds.length)redirect(withStatus(returnTo,"not-found"));
 const desiredStatus=actionType==="activate"?"ACTIVE":"PAUSED",batchId=randomUUID();
 const client=await db.pool.connect();
 try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
  if(!actor)throw new Error("actor_missing");
  for(const entity of entities){
   const idempotencyKey=createHash("sha256").update(`${project.id}:${entityType}:${entity.id}:${desiredStatus}:${entity.status}:${entity.effective_status}`).digest("hex");
   const request=(await client.query<{id:string}>(`insert into public.meta_manager_action_requests
    (organization_id,project_id,entity_type,entity_id,external_id,action_type,before_state,desired_state,reason,idempotency_key,requested_by_user_id)
    values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
    on conflict(project_id,idempotency_key) do update set updated_at=now() returning id`,
    [project.organization_id,project.id,entityType,entity.id,entity.external_id,actionType,
     JSON.stringify({name:entity.name,status:entity.status,effectiveStatus:entity.effective_status,batchId}),
     JSON.stringify({status:desiredStatus,batchId}),reason,idempotencyKey,actor.id])).rows[0]!;
   await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,before,after)
    values($1,$2,$3,'meta_manager_status_requested','meta_manager_action_request',$4,$5::jsonb,$6::jsonb)`,
    [project.organization_id,project.id,actor.id,request.id,
     JSON.stringify({status:entity.status,effectiveStatus:entity.effective_status}),
     JSON.stringify({status:desiredStatus,reason,batchId})]);
  }
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after)
   values($1,$2,$3,'meta_manager_bulk_status_requested','meta_manager_action_batch',$4,$5::jsonb)`,
   [project.organization_id,project.id,actor.id,batchId,JSON.stringify({entityType,actionType,desiredStatus,count:entityIds.length,entityIds})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(withStatus(returnTo,"request-failed"));}finally{client.release();}
 revalidatePath("/dashboard/gerenciador-anuncios");revalidatePath("/dashboard/campanhas/acoes");
 redirect(withStatus(returnTo,"bulk-requested"));
}

export async function requestManagerEdit(formData:FormData){
 const entityType=String(formData.get("entity_type")??""),entityId=String(formData.get("entity_id")??"");
 const field=String(formData.get("field")??""),reason=String(formData.get("reason")??"").trim().slice(0,1000);
 const returnTo=safeReturnTo(formData.get("return_to")),requestedName=String(formData.get("name")??"").trim().slice(0,255);
 const requestedBudget=Number(String(formData.get("budget")??"").replace(",","."));
 if(!["campaign","adset","ad"].includes(entityType)||!/^[0-9a-f-]{36}$/i.test(entityId)||!["name","budget"].includes(field)
  ||reason.length<5||(field==="name"&&!requestedName)||(field==="budget"&&(entityType==="ad"||!Number.isFinite(requestedBudget)
  ||requestedBudget<=0||requestedBudget>10000000)))redirect(withStatus(returnTo,"invalid-action"));
 const {authUserId,project,db}=await context();
 if(!["owner","administrator","editor"].includes(project.role))redirect(withStatus(returnTo,"forbidden"));
 const table={campaign:"meta_campaigns",adset:"meta_ad_sets",ad:"meta_ads"}[entityType]!;
 const budgetColumns=entityType!=="ad"?",daily_budget_minor,lifetime_budget_minor":"";
 const entity=(await db.pool.query<{id:string;external_id:string;name:string;status:string|null;effective_status:string|null;
  daily_budget_minor?:string|null;lifetime_budget_minor?:string|null}>(`select id,external_id,name,status,effective_status${budgetColumns}
  from public.${table} where id=$1 and project_id=$2`,[entityId,project.id])).rows[0];
 if(!entity)redirect(withStatus(returnTo,"not-found"));
 const actionType=field==="name"?"update_name":"update_budget";
 const desiredState=field==="name"?{name:requestedName}:{dailyBudgetMinor:Math.round(requestedBudget*100),currency:project.currency};
 const beforeState={name:entity.name,status:entity.status,effectiveStatus:entity.effective_status,
  dailyBudgetMinor:entity.daily_budget_minor??null,lifetimeBudgetMinor:entity.lifetime_budget_minor??null,currency:project.currency};
 const idempotencyKey=createHash("sha256").update(`${project.id}:${entityType}:${entityId}:${actionType}:${JSON.stringify(desiredState)}:${JSON.stringify(beforeState)}`).digest("hex");
 const client=await db.pool.connect();
 try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
  if(!actor)throw new Error("actor_missing");
  const request=(await client.query<{id:string}>(`insert into public.meta_manager_action_requests
   (organization_id,project_id,entity_type,entity_id,external_id,action_type,before_state,desired_state,reason,idempotency_key,requested_by_user_id)
   values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)
   on conflict(project_id,idempotency_key) do update set updated_at=now() returning id`,
   [project.organization_id,project.id,entityType,entityId,entity.external_id,actionType,JSON.stringify(beforeState),
    JSON.stringify(desiredState),reason,idempotencyKey,actor.id])).rows[0]!;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,before,after)
   values($1,$2,$3,'meta_manager_edit_requested','meta_manager_action_request',$4,$5::jsonb,$6::jsonb)`,
   [project.organization_id,project.id,actor.id,request.id,JSON.stringify(beforeState),JSON.stringify({...desiredState,reason,executionSupported:true})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect(withStatus(returnTo,"request-failed"));}finally{client.release();}
 revalidatePath("/dashboard/gerenciador-anuncios");revalidatePath("/dashboard/campanhas/acoes");
 redirect(withStatus(returnTo,"edit-requested"));
}

export async function decideManagerAction(formData:FormData){
 const id=String(formData.get("request_id")??""),decision=String(formData.get("decision")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!["approved","rejected"].includes(decision))redirect("/dashboard/campanhas/acoes?status=invalid");
 const {authUserId,project,db}=await context();
 if(!["owner","administrator"].includes(project.role))redirect("/dashboard/campanhas/acoes?status=forbidden");
 const client=await db.pool.connect();
 try{await client.query("begin");
  const actor=(await client.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
  if(!actor)throw new Error("actor_missing");
  const row=(await client.query<{id:string;action_type:string}>(`update public.meta_manager_action_requests set status=$1,
   decided_by_user_id=$2,decided_at=now(),updated_at=now() where id=$3 and project_id=$4 and status='pending_approval' returning id,action_type`,
   [decision,actor.id,id,project.id])).rows[0];if(!row)throw new Error("not_pending");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after)
   values($1,$2,$3,$4,'meta_manager_action_request',$5,$6::jsonb)`,[project.organization_id,project.id,actor.id,
   `meta_manager_${row.action_type.startsWith("update_")?"edit":"status"}_${decision}`,id,
   JSON.stringify({decision,actionType:row.action_type,execution:"not_started"})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/campanhas/acoes?status=failed");}finally{client.release();}
 revalidatePath("/dashboard/campanhas/acoes");redirect(`/dashboard/campanhas/acoes?status=${decision}`);
}

export async function executeApprovedManagerAction(formData:FormData){
 const id=String(formData.get("request_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/campanhas/acoes?status=invalid");
 const {authUserId,project,db}=await context();
 if(!["owner","administrator"].includes(project.role))redirect("/dashboard/campanhas/acoes?status=forbidden");
 const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[authUserId])).rows[0];
 if(!actor)redirect("/dashboard/campanhas/acoes?status=forbidden");
 const claimed=(await db.pool.query<{entity_type:"campaign"|"adset"|"ad";entity_id:string;external_id:string;
  action_type:"activate"|"pause"|"update_name"|"update_budget";desired_state:{status?:string;name?:string;dailyBudgetMinor?:number};connection_id:string}>(`
  update public.meta_manager_action_requests request set execution_status='executing',execution_attempts=execution_attempts+1,
   execution_started_at=now(),executed_by_user_id=$1,error_code=null,updated_at=now()
  from public.meta_ad_accounts account where request.id=$2 and request.project_id=$3 and request.status='approved'
   and request.execution_status in ('not_started','failed','state_mismatch')
   and request.action_type in ('activate','pause','update_name','update_budget')
   and account.project_id=request.project_id
   and account.id=(case request.entity_type when 'campaign' then (select meta_ad_account_id from public.meta_campaigns where id=request.entity_id)
    when 'adset' then (select meta_ad_account_id from public.meta_ad_sets where id=request.entity_id)
    else (select meta_ad_account_id from public.meta_ads where id=request.entity_id) end)
  returning request.entity_type,request.entity_id,request.external_id,request.action_type,request.desired_state,account.connection_id`,[actor.id,id,project.id])).rows[0];
 if(!claimed){
  const current=(await db.pool.query<{execution_status:string}>("select execution_status from public.meta_manager_action_requests where id=$1 and project_id=$2",[id,project.id])).rows[0];
  redirect(`/dashboard/campanhas/acoes?status=${current?.execution_status==="succeeded"?"execution-succeeded":"execution-unavailable"}`);
 }
 const desiredStatus=claimed.action_type==="activate"||claimed.action_type==="pause"?desiredMetaStatus(claimed.action_type):null;
 const desiredName=claimed.action_type==="update_name"?String(claimed.desired_state.name??""):null;
 const desiredBudget=claimed.action_type==="update_budget"?Number(claimed.desired_state.dailyBudgetMinor):null;
 if((claimed.action_type==="update_name"&&!desiredName)||(claimed.action_type==="update_budget"&&(!Number.isInteger(desiredBudget)||Number(desiredBudget)<=0))){
  await db.pool.query("update public.meta_manager_action_requests set execution_status='failed',error_code='invalid_desired_state',executed_at=now(),updated_at=now() where id=$1",[id]);
  redirect("/dashboard/campanhas/acoes?status=execution-failed");
 }
 let mutation:Record<string,unknown>={},actual:Record<string,unknown>={};
 try{
  await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after) values($1,$2,$3,'meta_manager_execution_started','meta_manager_action_request',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,id,JSON.stringify({entityType:claimed.entity_type,externalId:claimed.external_id,actionType:claimed.action_type,desiredState:claimed.desired_state})]);
  const token=await loadMetaConnectionAccessToken(db.pool,claimed.connection_id);
  if(!token)throw Object.assign(new Error("meta_token_missing"),{code:"meta_token_missing"});
  const mutationFields:Record<string,string>=claimed.action_type==="update_name"?{name:desiredName!}:
   claimed.action_type==="update_budget"?{daily_budget:String(desiredBudget!)}:{status:desiredStatus!};
  const response=await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(claimed.external_id)}`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({...mutationFields,access_token:token}),cache:"no-store"});
  mutation=await response.json() as Record<string,unknown>;
  if(!response.ok||mutation.error)throw Object.assign(new Error("meta_mutation_failed"),{code:"meta_mutation_failed"});
  const verifyFields=claimed.action_type==="update_name"?"id,name":claimed.action_type==="update_budget"?"id,daily_budget,lifetime_budget":"id,status,effective_status";
  const verifyResponse=await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(claimed.external_id)}?fields=${encodeURIComponent(verifyFields)}&access_token=${encodeURIComponent(token)}`,{cache:"no-store"});
  actual=await verifyResponse.json() as Record<string,unknown>;
  if(!verifyResponse.ok||actual.error)throw Object.assign(new Error("meta_verification_failed"),{code:"meta_verification_failed"});
  const matched=claimed.action_type==="update_name"?metaNameMatches(actual,desiredName!):claimed.action_type==="update_budget"?
   metaDailyBudgetMatches(actual,desiredBudget!):metaStateMatches(actual,desiredStatus!);
  const table={campaign:"meta_campaigns",adset:"meta_ad_sets",ad:"meta_ads"}[claimed.entity_type];
  const client=await db.pool.connect();try{await client.query("begin");
   if(matched&&claimed.action_type==="update_name")await client.query(`update public.${table} set name=$1,last_synced_at=now(),updated_at=now() where id=$2 and project_id=$3`,[actual.name,claimed.entity_id,project.id]);
   if(matched&&claimed.action_type==="update_budget"&&claimed.entity_type!=="ad")await client.query(`update public.${table} set daily_budget_minor=$1,last_synced_at=now(),updated_at=now() where id=$2 and project_id=$3`,[actual.daily_budget,claimed.entity_id,project.id]);
   if(matched&&desiredStatus)await client.query(`update public.${table} set status=$1,effective_status=$2,last_synced_at=now(),updated_at=now() where id=$3 and project_id=$4`,[actual.status,actual.effective_status??actual.status,claimed.entity_id,project.id]);
   await client.query(`update public.meta_manager_action_requests set execution_status=$1,actual_state=$2::jsonb,response_sanitized=$3::jsonb,executed_at=now(),updated_at=now() where id=$4`,[matched?"succeeded":"state_mismatch",JSON.stringify(sanitizeMetaResponse(actual)),JSON.stringify(sanitizeMetaResponse(mutation)),id]);
   await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after) values($1,$2,$3,$4,'meta_manager_action_request',$5,$6::jsonb)`,[project.organization_id,project.id,actor.id,matched?"meta_manager_execution_succeeded":"meta_manager_execution_state_mismatch",id,JSON.stringify({entityType:claimed.entity_type,externalId:claimed.external_id,actionType:claimed.action_type,desiredState:claimed.desired_state,actual:sanitizeMetaResponse(actual)})]);
   await client.query("commit");}catch(error){await client.query("rollback");throw error;}finally{client.release();}
  revalidatePath("/dashboard/gerenciador-anuncios");revalidatePath("/dashboard/campanhas/acoes");
  redirect(`/dashboard/campanhas/acoes?status=${matched?"execution-succeeded":"execution-state-mismatch"}`);
 }catch(error){
  if(error&&typeof error==="object"&&"digest" in error)throw error;
  const code=String((error as {code?:string})?.code??"meta_execution_failed").slice(0,100);
  await db.pool.query(`update public.meta_manager_action_requests set execution_status='failed',response_sanitized=$1::jsonb,actual_state=$2::jsonb,error_code=$3,executed_at=now(),updated_at=now() where id=$4`,[JSON.stringify(sanitizeMetaResponse(mutation)),JSON.stringify(sanitizeMetaResponse(actual)),code,id]);
  await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,target_type,target_id,after) values($1,$2,$3,'meta_manager_execution_failed','meta_manager_action_request',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,id,JSON.stringify({errorCode:code,actionType:claimed.action_type,desiredState:claimed.desired_state,response:sanitizeMetaResponse(mutation)})]);
  revalidatePath("/dashboard/campanhas/acoes");redirect("/dashboard/campanhas/acoes?status=execution-failed");
 }
}
