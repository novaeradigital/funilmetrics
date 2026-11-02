"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {decryptIntegrationSecret,loadIntegrationVaultKey} from "../../../../lib/integration-vault";
import {expandStructure,resolveNamingPattern,buildUtmQuery,type NamingContext} from "../../../../lib/campaign-naming";

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
async function loadProvider(projectId:string,provider:"openai"|"anthropic"){
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

const copyInstruction="Voce escreve copy de anuncio em portugues do Brasil para o produto informado. Use a transcricao do criativo como base, sem inventar promessas nem resultados. Gere exatamente 3 modelos diferentes de copy. Responda somente com um JSON valido no formato {\"copies\":[{\"primaryText\":\"...\",\"headline\":\"...\",\"cta\":\"...\"}]}. cta curto, por exemplo: Saiba mais, Comprar agora, Quero comecar.";

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

export async function generateCopies(input:{
 productName:string;
 items:Array<{creativeId:string;name:string;transcript:string|null}>;
}):Promise<{ok:boolean;error?:string;copies?:Record<string,CopyModel[]>}>{
 const actor=await requireEditor();
 const openai=await loadProvider(actor.projectId,"openai");
 const provider=openai?.configuration.analysisProvider==="anthropic"?"anthropic":"openai";
 const chosen=provider==="anthropic"?await loadProvider(actor.projectId,"anthropic"):openai;
 const fallback=provider==="anthropic"?openai:await loadProvider(actor.projectId,"anthropic");
 const run=async(cfg:{apiKey:string;model:string},which:"openai"|"anthropic",prompt:string)=>
  which==="anthropic"?callAnthropic(cfg.apiKey,cfg.model,prompt):callOpenAi(cfg.apiKey,cfg.model,prompt);
 const out:Record<string,CopyModel[]>={};
 try{
  for(const item of input.items.slice(0,50)){
   const prompt=`Produto: ${input.productName||"nao informado"}\nCriativo: ${item.name}\nTranscricao:\n${(item.transcript??"").slice(0,20000)||"(sem transcricao; use o nome do criativo e o produto)"}`;
   let copies:CopyModel[];
   if(chosen){try{copies=await run(chosen,provider,prompt);}
    catch{if(fallback)copies=await run(fallback,provider==="anthropic"?"openai":"anthropic",prompt);else throw new Error("provider_failed");}}
   else if(fallback){copies=await run(fallback,provider==="anthropic"?"openai":"anthropic",prompt);}
   else return {ok:false,error:"Nenhum provedor de IA configurado. Configure OpenAI ou Anthropic em Integracoes."};
   out[item.creativeId]=copies!;
  }
 }catch{return {ok:false,error:"A geracao de copy falhou no provedor de IA. Tente de novo."};}
 return {ok:true,copies:out};
}
