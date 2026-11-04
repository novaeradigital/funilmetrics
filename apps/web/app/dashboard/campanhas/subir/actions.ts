"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {decryptIntegrationSecret,loadIntegrationVaultKey} from "../../../../lib/integration-vault";
import {expandStructure,resolveNamingPattern,buildUtmQuery,type NamingContext} from "../../../../lib/campaign-naming";
import {loadMetaConnectionAccessToken} from "../../../../lib/meta-oauth";

type Actor={userId:string;projectId:string;organizationId:string};
async function requireEditor():Promise<Actor>{
 const supabase=await createClient();const {data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);
 if(!project||!["owner","administrator","editor"].includes(project.role))
  redirect("/dashboard/campanhas/subir?status=forbidden");
 const db=getDatabase();
 const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0];
 if(!actor)redirect("/dashboard/campanhas/subir?status=forbidden");
 return {userId:actor.id,projectId:project.id,organizationId:project.organization_id};
}

type CopyModel={primaryText:string;headline:string;cta:string};
type CreativeSnapshot={id:string;name:string;format:string;transcript:string|null};
type Destination={accountId:string;accountExternalId:string;accountName:string;pageId:string;instagramId:string;pixelId:string;event:string};
type UploadConfig={
 version:string;
 destinations:Destination[];
 creatives:CreativeSnapshot[];
 structure:{campaigns:number;adSetsPerCampaign:number;adsPerAdSet:number;duplications:number;distribution:"rotate"|"sequence"|"all"};
 adSet:{objective:string;budgetLevel:"campaign"|"adset";dailyBudget:number;countries:string;ageMin:number;ageMax:number;gender:string;destinationUrl:string};
 naming:{campaignPattern:string;adSetPattern:string;adPattern:string;separator:string;casing:"original"|"upper"|"lower";dateFormat:string};
 utms:Record<string,string>;
 copies:{mode:"global"|"per_creative";global?:CopyModel;perCreative?:Record<string,CopyModel>};
 productName:string;
};

function namingBase(config:UploadConfig,destination:Destination):NamingContext{
 return {
  produto:config.productName||undefined,
  pais:config.adSet.countries||undefined,
  data:new Date(),
  conta:destination.accountName||undefined,
  pagina:destination.pageId||undefined,
  objetivo:config.adSet.objective||undefined,
  orcamento:config.adSet.dailyBudget||undefined,
 };
}

function buildItems(config:UploadConfig){
 const items:Array<Record<string,unknown>>=[];
 const namingOpts={separator:config.naming.separator||"_",casing:config.naming.casing,dateFormat:config.naming.dateFormat as never};
 for(const destination of config.destinations){
  const slots=expandStructure(config.structure,config.creatives.length);
  const base=namingBase(config,destination);
  const campaignKeys=new Map<string,string>();
  const adSetKeys=new Map<string,string>();
  for(const slot of slots){
   const creative=config.creatives[slot.creativeIndex]!;
   const ctx:NamingContext={...base,criativo:creative.name,formato:creative.format,sequencia:slot.sequence};
   const campaignName=resolveNamingPattern(config.naming.campaignPattern,ctx,namingOpts);
   const adSetName=resolveNamingPattern(config.naming.adSetPattern,ctx,namingOpts);
   const adName=resolveNamingPattern(config.naming.adPattern,ctx,namingOpts);
   const campaignKey=`${destination.accountExternalId}:c${slot.campaignIndex}`;
   if(!campaignKeys.has(campaignKey)){
    campaignKeys.set(campaignKey,campaignName);
    items.push({account_external_id:destination.accountExternalId,level:"campaign",
     name:campaignName,creative_id:null,parent_key:null,
     idempotency_key:campaignKey,copy:null,payload:{objective:config.adSet.objective}});
   }
   const adSetKey=`${campaignKey}:s${slot.adSetIndex}`;
   if(!adSetKeys.has(adSetKey)){
    adSetKeys.set(adSetKey,adSetName);
    items.push({account_external_id:destination.accountExternalId,level:"adset",
     name:adSetName,creative_id:null,parent_key:campaignKey,
     idempotency_key:adSetKey,copy:null,
     payload:{dailyBudget:config.adSet.dailyBudget,budgetLevel:config.adSet.budgetLevel,
      countries:config.adSet.countries,ageMin:config.adSet.ageMin,ageMax:config.adSet.ageMax,
      gender:config.adSet.gender,pixelId:destination.pixelId,event:destination.event,
      pageId:destination.pageId,instagramId:destination.instagramId}});
   }
   const utmTemplate={
    utm_source:config.utms.utm_source,utm_medium:config.utms.utm_medium,
    utm_campaign:(config.utms.utm_campaign??"").replaceAll("{campanha}",campaignName),
    utm_content:(config.utms.utm_content??"").replaceAll("{anuncio}",adName),
    utm_term:config.utms.utm_term,
   };
   const utmQuery=buildUtmQuery(utmTemplate,ctx,namingOpts);
   const url=utmQuery?`${config.adSet.destinationUrl}${config.adSet.destinationUrl.includes("?")?"&":"?"}${utmQuery}`:config.adSet.destinationUrl;
   const copy=config.copies.mode==="per_creative"
    ? config.copies.perCreative?.[creative.id] ?? config.copies.global ?? null
    : config.copies.global ?? null;
   items.push({account_external_id:destination.accountExternalId,level:"ad",
    name:adName,creative_id:creative.id,parent_key:adSetKey,
    idempotency_key:`${adSetKey}:a${slot.adIndex}:${slot.sequence}`,
    copy,payload:{destinationUrl:url,utmQuery,pageId:destination.pageId,
     instagramId:destination.instagramId,creativeName:creative.name,creativeFormat:creative.format}});
  }
 }
 return items;
}

export async function createUpload(formData:FormData){
 const actor=await requireEditor();
 const sendMode=String(formData.get("send_mode")??"draft");
 const rawConfig=String(formData.get("config")??"");
 let config:UploadConfig;
 try{config=JSON.parse(rawConfig) as UploadConfig;}catch{redirect("/dashboard/campanhas/subir?status=invalid");}
 if(!config!.destinations?.length||!config!.creatives?.length)
  redirect("/dashboard/campanhas/subir?status=invalid");
 const mode=sendMode==="paused"||sendMode==="active"?sendMode:"draft";
 const items=buildItems(config!);
 // Reuso de video entre subidas: se este criativo ja foi enviado para a
 // mesma conta, o anuncio ja nasce com o video da Meta e o publicador pula
 // o envio do arquivo, que e a parte lenta.
 try{
  const prior=(await getDatabase().pool.query<{account_external_id:string;creative_id:string;vid:string}>(
   `select distinct on (i.account_external_id,i.creative_id)
     i.account_external_id,i.creative_id,i.payload->>'metaVideoId' as vid
    from public.campaign_upload_items i
    join public.campaign_uploads u on u.id=i.upload_id
    where u.project_id=$1 and i.level='ad' and i.status='created'
      and i.payload->>'metaVideoId' is not null
    order by i.account_external_id,i.creative_id,i.created_at desc`,
   [actor.projectId])).rows;
  const byKey=new Map(prior.map(r=>[`${r.account_external_id}:${r.creative_id}`,r.vid]));
  for(const item of items){
   if(item.level!=="ad"||!item.creative_id)continue;
   const vid=byKey.get(`${item.account_external_id}:${item.creative_id}`);
   if(vid)(item.payload as Record<string,unknown>).metaVideoId=vid;
  }
 }catch{/* sem reuso, o publicador envia o video normalmente */}
 // Heranca de projeto de negocio (D-174): criativo ainda sem projeto que
 // vai ser publicado numa conta associada herda o projeto da conta.
 try{
  const extIds=[...new Set(config!.destinations.map(d=>d.accountExternalId))];
  const accs=(await getDatabase().pool.query<{external_id:string;business_project_id:string|null}>(
   `select external_id, business_project_id::text as business_project_id
     from public.meta_ad_accounts
    where project_id=$1 and external_id = any($2) and business_project_id is not null`,
   [actor.projectId,extIds])).rows;
  const creativeIds=config!.creatives.map(c=>c.id);
  for(const acc of accs){
   await getDatabase().pool.query(
    `update public.creatives set business_project_id=$1, updated_at=now()
      where project_id=$2 and id = any($3) and business_project_id is null`,
    [acc.business_project_id,actor.projectId,creativeIds]);
  }
 }catch{/* heranca e automatica e opcional; nao bloqueia a subida */}
 const summary={
  accounts:config!.destinations.length,
  campaigns:items.filter(i=>i.level==="campaign").length,
  adSets:items.filter(i=>i.level==="adset").length,
  ads:items.filter(i=>i.level==="ad").length,
 };
 const db=getDatabase();const client=await db.pool.connect();
 try{
  await client.query("begin");
  const upload=(await client.query<{id:string}>(`insert into public.campaign_uploads
   (organization_id,project_id,created_by_user_id,status,send_mode,config,summary)
   values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`,
   [actor.organizationId,actor.projectId,actor.userId,
    mode==="draft"?"draft":"queued",mode,JSON.stringify(config!),JSON.stringify(summary)])).rows[0]!;
  const itemIds=new Map<string,string>();
  for(const item of items){
   const parentId=item.parent_key?itemIds.get(String(item.parent_key))??null:null;
   const row=(await client.query<{id:string}>(`insert into public.campaign_upload_items
    (organization_id,project_id,upload_id,account_external_id,level,name,creative_id,
     parent_item_id,idempotency_key,status,copy,payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10::jsonb,$11::jsonb) returning id`,
    [actor.organizationId,actor.projectId,upload.id,item.account_external_id,item.level,
     item.name,item.creative_id,parentId,item.idempotency_key,
     item.copy?JSON.stringify(item.copy):null,JSON.stringify(item.payload)])).rows[0]!;
   itemIds.set(String(item.idempotency_key),row.id);
  }
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,$4,'campaign_upload',$5,$6::jsonb)`,
   [actor.organizationId,actor.projectId,actor.userId,
    mode==="draft"?"campaign_upload_draft_saved":"campaign_upload_queued",
    upload.id,JSON.stringify({sendMode:mode,summary})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/campanhas/subir?status=failed");}
 finally{client.release();}
 revalidatePath("/dashboard/campanhas/publicacoes");
 redirect(`/dashboard/campanhas/publicacoes?status=${mode==="draft"?"draft-saved":"queued"}`);
}

export async function saveTemplate(formData:FormData){
 const actor=await requireEditor();
 const name=String(formData.get("name")??"").trim().slice(0,120);
 const rawConfig=String(formData.get("config")??"");
 if(!name||!rawConfig)redirect("/dashboard/campanhas/subir?status=invalid");
 let parsed:unknown;try{parsed=JSON.parse(rawConfig);}catch{redirect("/dashboard/campanhas/subir?status=invalid");}
 const db=getDatabase();
 await db.pool.query(`insert into public.campaign_upload_templates
  (organization_id,project_id,name,config,created_by_user_id) values($1,$2,$3,$4::jsonb,$5)`,
  [actor.organizationId,actor.projectId,name,JSON.stringify(parsed),actor.userId]);
 revalidatePath("/dashboard/campanhas/subir");
 redirect("/dashboard/campanhas/subir?status=template-saved");
}

// ---------- Geracao de copy (D-170/D-172) ----------
type StoredProvider={configuration:Record<string,unknown>;ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer};
async function loadProvider(projectId:string,provider:"openai"|"anthropic"|"openrouter"){
 const db=getDatabase();
 const stored=(await db.pool.query<StoredProvider>(`select connection.configuration,secret.ciphertext,
  secret.initialization_vector,secret.authentication_tag from public.connections connection
  join lateral(select ciphertext,initialization_vector,authentication_tag from public.integration_secrets
   where project_id=connection.project_id and provider=$2 and kind='credential_bundle'
   and rotated_at is null order by created_at desc limit 1) secret on true
  where connection.project_id=$1 and connection.provider=$2 and connection.status='active'
  order by connection.created_at desc limit 1`,[projectId,provider])).rows[0];
 const key=loadIntegrationVaultKey();if(!stored||!key)return null;
 const secret=decryptIntegrationSecret({ciphertext:stored.ciphertext,
  initializationVector:stored.initialization_vector,authenticationTag:stored.authentication_tag},key);
 const apiKey=String(secret.apiKey??"").trim();
 const model=String(stored.configuration.analysisModel??"").trim();
 if(!apiKey||!model)return null;
 return {apiKey,model,configuration:stored.configuration};
}

const CTA_OPTIONS=["Saiba mais","Comprar agora","Cadastre-se","Quero começar","Entre em contato","Baixar agora"];
function normalizeCta(value:unknown):string{
 const text=typeof value==="string"?value.trim().toLowerCase():"";
 const found=CTA_OPTIONS.find(option=>option.toLowerCase()===text);
 return found??"Saiba mais";}
const copyInstruction="Voce escreve copy de anuncio em portugues do Brasil. A base da copy e o VIDEO do criativo: use a analise e a transcricao do video para criar o texto principal e o titulo, falando do que o video mostra, demonstra e promete. O nome do produto e apenas o contexto da oferta; nao invente promessas, resultados nem caracteristicas que nao estejam na analise ou na transcricao. Gere exatamente 3 modelos diferentes de copy. O campo cta deve ser exatamente um destes botoes padrao do Facebook, escolhido pelo sentido da copy: Saiba mais, Comprar agora, Cadastre-se, Quero começar, Entre em contato, Baixar agora. Responda somente com um JSON valido no formato {\"copies\":[{\"primaryText\":\"...\",\"headline\":\"...\",\"cta\":\"...\"}]}.";

async function callOpenAi(apiKey:string,model:string,prompt:string):Promise<CopyModel[]>{
 const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",
  headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
  body:JSON.stringify({model,store:false,input:[
   {role:"system",content:copyInstruction},{role:"user",content:prompt}]})});
 if(!response.ok)throw new Error(`openai_http_${response.status}`);
 const payload=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
 let text="";
 for(const item of payload.output??[])for(const content of item.content??[])
  if(content.type==="output_text"&&typeof content.text==="string")text=content.text;
 const parsed=JSON.parse(text) as {copies:CopyModel[]};
 return parsed.copies.slice(0,3);
}

async function callOpenRouter(apiKey:string,model:string,prompt:string):Promise<CopyModel[]>{
 const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",
  headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
  body:JSON.stringify({model,messages:[
   {role:"system",content:copyInstruction},{role:"user",content:prompt}]})});
 if(response.status===402)throw new Error("insufficient_quota");
 if(!response.ok)throw new Error(`openrouter_http_${response.status}`);
 const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>};
 const text=payload.choices?.[0]?.message?.content??"";
 const cleaned=text.trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
 const parsed=JSON.parse(cleaned) as {copies:CopyModel[]};
 return parsed.copies.slice(0,3);
}

async function callAnthropic(apiKey:string,model:string,prompt:string):Promise<CopyModel[]>{
 const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
  headers:{"x-api-key":apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json"},
  body:JSON.stringify({model,max_tokens:4096,system:copyInstruction,
   messages:[{role:"user",content:prompt}]})});
 if(!response.ok)throw new Error(`anthropic_http_${response.status}`);
 const payload=await response.json() as {content?:Array<{type?:string;text?:string}>};
 const text=(payload.content??[]).find(c=>c.type==="text")?.text??"";
 const cleaned=text.trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
 const parsed=JSON.parse(cleaned) as {copies:CopyModel[]};
 return parsed.copies.slice(0,3);
}

export type DestinationPage={id:string;name:string;instagramId:string;instagramUsername:string};
export async function getDestinationPages(accountExternalId:string):Promise<{ok:boolean;error?:string;pages?:DestinationPage[]}>{
 const actor=await requireEditor();
 const db=getDatabase();
 const account=(await db.pool.query<{connection_id:string}>(
  "select connection_id from public.meta_ad_accounts where project_id=$1 and external_id=$2 limit 1",
  [actor.projectId,accountExternalId])).rows[0];
 if(!account)return {ok:false,error:"Conta nao encontrada neste projeto."};
 let token:string|null=null;
 try{token=await loadMetaConnectionAccessToken(db.pool,account.connection_id);}catch{token=null;}
 if(!token)return {ok:false,error:"Conexao da Meta sem token valido. Reconecte o perfil em Integracoes."};
 const graph=async(path:string):Promise<Record<string,unknown>>=>{
  const res=await fetch(`https://graph.facebook.com/v25.0/${path}${path.includes("?")?"&":"?"}access_token=${encodeURIComponent(token as string)}`);
  return (await res.json().catch(()=>({}))) as Record<string,unknown>;
 };
 const perms=await graph("me/permissions?limit=100").catch(()=>null);
 const granted=new Set(((perms?.data??[]) as Array<{permission:string;status:string}>)
  .filter(entry=>entry.status==="granted").map(entry=>entry.permission));
 if(!granted.has("pages_show_list"))
  return {ok:false,error:"O perfil desta conta ainda nao tem a permissao de Paginas. Reconecte a Meta em Integracoes para liberar a lista."};
 const pages=new Map<string,DestinationPage>();
 const addPage=(raw:Record<string,unknown>)=>{
  const id=String(raw.id??"");
  if(!id||pages.has(id))return;
  const ig=(raw.instagram_business_account??raw.connected_instagram_account) as {id?:string;username?:string}|undefined;
  pages.set(id,{id,name:String(raw.name??id),instagramId:String(ig?.id??""),instagramUsername:String(ig?.username??"")});
 };
 const fields="id,name,instagram_business_account{id,username},connected_instagram_account{id,username}";
 const mine=await graph(`me/accounts?fields=${fields}&limit=100`).catch(()=>null);
 for(const page of (mine?.data??[]) as Array<Record<string,unknown>>)addPage(page);
 const businesses=await graph("me/businesses?fields=id&limit=50").catch(()=>null);
 for(const business of (businesses?.data??[]) as Array<{id:string}>){
  for(const kind of ["owned_pages","client_pages"]){
   const res=await graph(`${business.id}/${kind}?fields=${fields}&limit=100`).catch(()=>null);
   for(const page of (res?.data??[]) as Array<Record<string,unknown>>)addPage(page);
  }
 }
 return {ok:true,pages:[...pages.values()].sort((a,b)=>a.name.localeCompare(b.name))};
}

export type DestinationPixel={id:string;name:string};
export async function getDestinationPixels(accountExternalId:string):Promise<{ok:boolean;error?:string;pixels?:DestinationPixel[]}>{
 const actor=await requireEditor();
 const db=getDatabase();
 const account=(await db.pool.query<{connection_id:string}>(
  "select connection_id from public.meta_ad_accounts where project_id=$1 and external_id=$2 limit 1",
  [actor.projectId,accountExternalId])).rows[0];
 if(!account)return {ok:false,error:"Conta nao encontrada neste projeto."};
 let token:string|null=null;
 try{token=await loadMetaConnectionAccessToken(db.pool,account.connection_id);}catch{token=null;}
 if(!token)return {ok:false,error:"Conexao da Meta sem token valido. Reconecte o perfil em Integracoes."};
 const res=await fetch(`https://graph.facebook.com/v25.0/${accountExternalId}/adspixels?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`)
  .catch(()=>null);
 const payload=(await res?.json().catch(()=>({}))) as {data?:Array<{id:string;name?:string}>;error?:{message?:string}}|undefined;
 if(!payload||payload.error)return {ok:false,error:"Nao foi possivel carregar os pixels desta conta."};
 const pixels=(payload.data??[]).map(entry=>({id:String(entry.id),name:String(entry.name??entry.id)}))
  .sort((a,b)=>a.name.localeCompare(b.name));
 return {ok:true,pixels};
}

function formatAnalysis(analysis:Record<string,unknown>):string{
 const labels:Record<string,string>={hook:"Gancho",promise:"Promessa",mechanism:"Mecanismo",proof:"Prova",objections:"Objecoes",cta:"CTA do video",structure:"Estrutura",evidence:"Evidencias"};
 const lines:string[]=[];
 for(const [key,label] of Object.entries(labels)){
  const value=analysis[key];
  if(value===null||value===undefined)continue;
  const text=typeof value==="string"?value:JSON.stringify(value);
  if(text&&text!=="{}"&&text!=="[]")lines.push(label+": "+text);
 }
 return lines.join("\n");
}

async function enqueueCreativeAiJobs(db:ReturnType<typeof getDatabase>,actor:Actor,creativeIds:string[]){
 const cfg=(await db.pool.query<{transcriptionModel:string|null;analysisModel:string|null}>(
  `select configuration->>'transcriptionModel' as "transcriptionModel",
          configuration->>'analysisModel' as "analysisModel"
     from public.connections
    where project_id=$1 and provider='openai' and status='active'
    order by created_at desc limit 1`,[actor.projectId])).rows[0];
 const promptVersion="creative-analysis-v2-performance-aware";
 for(const creativeId of creativeIds){
  const scope=(await db.pool.query<{versionId:string;sha:string;mime:string;malware:string;available:Date|null}>(
   `select v.id::text as "versionId", v.content_sha256 as sha,
           a.mime_type as mime, a.malware_status::text as malware,
           a.available_at as available
      from public.creatives c
      join public.creative_versions v on v.id=c.current_version_id
      join public.creative_assets a on a.id=v.asset_id
     where c.id=$1 and c.project_id=$2`,[creativeId,actor.projectId])).rows[0];
  if(!scope)continue;
  if(cfg?.transcriptionModel&&scope.mime.startsWith("video/")&&scope.malware==="clean"&&scope.available){
   await db.pool.query(
    `insert into public.creative_ai_jobs (organization_id,project_id,creative_id,creative_version_id,kind,status,idempotency_key,model,requested_by_user_id)
     values ($1,$2,$3,$4,'transcription','pending',$5,$6,$7)
     on conflict (creative_version_id,kind,idempotency_key) do nothing`,
    [actor.organizationId,actor.projectId,creativeId,scope.versionId,
     "transcription:v1:"+scope.sha+":"+cfg.transcriptionModel,cfg.transcriptionModel,actor.userId]);
  }
  if(cfg?.analysisModel){
   const fp=(await db.pool.query<{fp:string}>(
    `select coalesce((select md5(concat(max(insight.metric_date)::text,':',
       sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required'))::text,':',
       sum(insight.impressions)::text,':',sum(insight.clicks)::text))
        from public.creative_ad_links link
        join public.meta_ad_insights_daily insight on insight.meta_ad_id=link.meta_ad_id
       where link.creative_version_id=$1),'none') as fp`,[scope.versionId])).rows[0]?.fp??"none";
   await db.pool.query(
    `insert into public.creative_ai_jobs (organization_id,project_id,creative_id,creative_version_id,kind,status,idempotency_key,model,prompt_version,requested_by_user_id)
     values ($1,$2,$3,$4,'analysis','pending',$5,$6,$7,$8)
     on conflict (creative_version_id,kind,idempotency_key) do nothing`,
    [actor.organizationId,actor.projectId,creativeId,scope.versionId,
     "analysis:"+promptVersion+":"+scope.sha+":"+cfg.analysisModel+":"+fp,
     cfg.analysisModel,promptVersion,actor.userId]);
  }
 }
}

export async function generateCopies(input:{
 productName:string;
 items:Array<{creativeId:string;key?:string;name:string;transcript:string|null}>;
}):Promise<{ok:boolean;error?:string;copies?:Record<string,CopyModel[]>}>{
 const actor=await requireEditor();
 type AiProviderName="openai"|"anthropic"|"openrouter";
 const openai=await loadProvider(actor.projectId,"openai");
 const rawProvider=openai?.configuration.analysisProvider;
 const provider:AiProviderName=rawProvider==="anthropic"?"anthropic":rawProvider==="openrouter"?"openrouter":"openai";
 const providers:Record<AiProviderName,{apiKey:string;model:string}|null>={
  openai,anthropic:await loadProvider(actor.projectId,"anthropic"),
  openrouter:await loadProvider(actor.projectId,"openrouter")};
 const order:AiProviderName[]=[provider,...(["openai","anthropic","openrouter"] as AiProviderName[]).filter(name=>name!==provider)];
 const run=async(cfg:{apiKey:string;model:string},which:AiProviderName,prompt:string)=>
  which==="anthropic"?callAnthropic(cfg.apiKey,cfg.model,prompt)
  :which==="openrouter"?callOpenRouter(cfg.apiKey,cfg.model,prompt)
  :callOpenAi(cfg.apiKey,cfg.model,prompt);
 const db=getDatabase();
 const ids=input.items.map(i=>i.creativeId).filter(id=>id!=="__global");
 type BaseRow={id:string;transcript:string|null;analysis:Record<string,unknown>|null};
 const baseRows=ids.length?(await db.pool.query<BaseRow>(
  `select c.id::text as id,
          (select t.text from public.creative_transcripts t
            where t.creative_version_id=c.current_version_id
            order by t.created_at desc limit 1) as transcript,
          (select to_jsonb(a) from (select hook,promise,mechanism,proof,objections,cta,structure,evidence
             from public.creative_analyses
            where creative_version_id=c.current_version_id
            order by created_at desc limit 1) a) as analysis
     from public.creatives c
    where c.project_id=$1 and c.id=any($2::uuid[])`,
  [actor.projectId,ids])).rows:[];
 const baseById=new Map(baseRows.map(r=>[r.id,r]));
 const missing=input.items.filter(item=>{
  if(item.creativeId==="__global")return false;
  const base=baseById.get(item.creativeId);
  const transcript=(base?.transcript??item.transcript??"").trim();
  return !transcript&&!base?.analysis;});
 if(missing.length){
  await enqueueCreativeAiJobs(db,actor,missing.map(m=>m.creativeId));
  const names=missing.map(m=>m.name).join(", ");
  return {ok:false,error:"Os criativos "+names+" ainda nao tem transcricao nem analise do video, e sem isso a copy sai generica. Ja pedi a transcricao e a analise deles agora; aguarde alguns minutos e gere as copys de novo."};
 }
 const out:Record<string,CopyModel[]>={};
 try{
  for(const item of input.items.slice(0,50)){
   const base=baseById.get(item.creativeId);
   const transcriptText=(base?.transcript??item.transcript??"").slice(0,20000);
   const analysisText=base?.analysis?formatAnalysis(base.analysis):"";
   const prompt="Produto (contexto da oferta): "+(input.productName||"nao informado")
    +"\nCriativo: "+item.name
    +(analysisText?"\n\nAnalise do video:\n"+analysisText:"")
    +(transcriptText?"\n\nTranscricao do video:\n"+transcriptText:"\n\n(sem transcricao; baseie-se na analise do video)");
   let copies:CopyModel[]|undefined;let lastError:unknown=null;
   for(const which of order){const cfg=providers[which];if(!cfg)continue;
    try{copies=await run(cfg,which,prompt);break;}catch(err){lastError=err;}}
   if(!copies){if(lastError)throw lastError;
    return {ok:false,error:"Nenhum provedor de IA configurado. Configure OpenAI, Anthropic ou OpenRouter em Integracoes."};}
   out[item.key??item.creativeId]=copies.map(c=>({primaryText:c.primaryText,headline:c.headline,cta:normalizeCta(c.cta)}));
  }
 }catch(err){const detail=err instanceof Error?err.message:String(err);
  const friendly=/insufficient_quota|credit/i.test(detail)?"A conta do provedor de IA esta sem creditos. Adicione creditos no provedor escolhido ou configure outro em Integracoes.":
   /model/i.test(detail)?"O modelo de IA configurado nao respondeu. Confira o modelo salvo em Integracoes.":
   "A geracao de copy falhou no provedor de IA. Tente de novo.";
  return {ok:false,error:friendly};}
 return {ok:true,copies:out};
}
