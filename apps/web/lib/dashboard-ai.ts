import "server-only";
import type {Database} from "@funil-metrics/database";
import {dashboardMetricCatalog} from "./dashboard-metrics";
import {decryptIntegrationSecret,loadIntegrationVaultKey} from "./integration-vault";
import {validateDashboardAiProposal} from "./dashboard-ai-proposal";

type StoredOpenAI={
 configuration:Record<string,unknown>;ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer;
};
type ResponsePayload={output?:Array<{content?:Array<{type?:string;text?:string}>}>;
 usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number}};

function outputText(payload:ResponsePayload){
 for(const item of payload.output??[])for(const content of item.content??[])
  if(content.type==="output_text"&&typeof content.text==="string")return content.text;
 throw new Error("dashboard_ai_output_missing");
}

export async function proposeDashboard(database:Database,projectId:string,prompt:string){
 const stored=(await database.pool.query<StoredOpenAI>(`select connection.configuration,secret.ciphertext,
  secret.initialization_vector,secret.authentication_tag from public.connections connection
  join lateral(select ciphertext,initialization_vector,authentication_tag from public.integration_secrets
   where project_id=connection.project_id and provider='openai' and kind='credential_bundle'
   and rotated_at is null order by created_at desc limit 1) secret on true
  where connection.project_id=$1 and connection.provider='openai' and connection.status='active'
  order by connection.created_at desc limit 1`,[projectId])).rows[0];
 const key=loadIntegrationVaultKey();if(!stored||!key)throw new Error("dashboard_ai_unavailable");
 const secret=decryptIntegrationSecret({ciphertext:stored.ciphertext,
  initializationVector:stored.initialization_vector,authenticationTag:stored.authentication_tag},key);
 const apiKey=String(secret.apiKey??"").trim(),model=String(stored.configuration.analysisModel??"").trim();
 const monthlyBudget=Number(stored.configuration.monthlyBudgetBrl??0);
 if(!apiKey||!model||!Number.isFinite(monthlyBudget)||monthlyBudget<=0)throw new Error("dashboard_ai_unavailable");
 const spent=Number((await database.pool.query<{spent:string}>(`select
  coalesce((select sum(estimated_cost_brl) from public.ai_usage_records where project_id=$1
   and measured_at>=date_trunc('month',now())),0)+coalesce((select sum(estimated_cost_brl)
   from public.dashboard_ai_requests where project_id=$1 and created_at>=date_trunc('month',now())),0) spent`,
  [projectId])).rows[0]?.spent??0);
 if(spent>=monthlyBudget)throw new Error("dashboard_ai_budget");
 const metrics=dashboardMetricCatalog.map(item=>({key:item.key,label:item.label,description:item.description,
  format:item.format,ruleVersion:item.ruleVersion}));
 const schema={type:"object",additionalProperties:false,required:["title","description","periodDays","widgets"],
  properties:{title:{type:"string"},description:{type:"string"},periodDays:{type:"integer",enum:[7,30,90,365]},
   widgets:{type:"array",minItems:1,maxItems:12,items:{type:"object",additionalProperties:false,
    required:["title","type","metric","width"],properties:{title:{type:"string"},
     type:{type:"string",enum:["kpi","time_series","bar","donut","funnel","table","comparison"]},
     metric:{type:"string",enum:metrics.map(item=>item.key)},width:{type:"integer",enum:[3,4,6,8,12]}}}}}};
 const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",
  headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
  body:JSON.stringify({model,store:false,input:[
   {role:"system",content:"Você compõe dashboards executivos em português do Brasil. Use somente as métricas fornecidas. Não invente dados, fórmulas ou causalidade. Retorne uma composição clara e compacta para revisão humana."},
   {role:"user",content:`Objetivo informado:\n${prompt}\n\nCatálogo governado:\n${JSON.stringify(metrics)}`}],
   text:{format:{type:"json_schema",name:"dashboard_proposal",strict:true,schema}}})});
 if(!response.ok)throw new Error(`dashboard_ai_http_${response.status}`);
 const payload=await response.json() as ResponsePayload;
 return {proposal:validateDashboardAiProposal(JSON.parse(outputText(payload))),model,usage:payload.usage??{}};
}
