import type pg from "pg";
import { loadProjectAnthropicConfig, loadProjectOpenAIConfig, loadProjectOpenRouterConfig, type AnthropicProjectConfig, type OpenAIProjectConfig, type OpenRouterProjectConfig } from "./integration-credentials.js";
import { analysisCostBrl, assertAiBudgetAvailable, loadAiPricing } from "./ai-budget.js";

type Job = {
  id:string; organization_id:string; project_id:string; creative_id:string;
  creative_version_id:string; model:string; prompt_version:string; attempts:number;
  transcript:string;
};

const schema = {
  type:"object", additionalProperties:false,
  required:["hook","promise","mechanism","proof","objections","cta","structure",
    "performance_hypotheses","evidence","confidence","tags"],
  properties:{
    hook:{type:["string","null"]}, promise:{type:["string","null"]},
    mechanism:{type:["string","null"]}, cta:{type:["string","null"]},
    proof:{type:"array",items:{type:"string"}}, objections:{type:"array",items:{type:"string"}},
    structure:{type:"array",items:{type:"string"}},
    performance_hypotheses:{type:"array",items:{type:"string"}},
    evidence:{type:"array",items:{type:"string"}},
    confidence:{type:"number",minimum:0,maximum:1},
    tags:{type:"array",maxItems:12,items:{type:"string"}},
  },
};

function normalizeTag(value:string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80);
}

async function claim(pool:pg.Pool,maxAttempts:number) {
  const client=await pool.connect();
  try {
    await client.query("begin");
    const result=await client.query<Job>(
      `select job.id,job.organization_id,job.project_id,job.creative_id,
              job.creative_version_id,job.model,job.prompt_version,job.attempts,
              transcript.text transcript
         from public.creative_ai_jobs job
         join lateral (select text from public.creative_transcripts
          where creative_version_id=job.creative_version_id
          order by created_at desc limit 1) transcript on true
        where job.kind='analysis' and job.status in ('pending','failed_retryable')
          and job.attempts<$1 order by job.created_at
        for update of job skip locked limit 1`,[maxAttempts]);
    const job=result.rows[0];
    if (!job) { await client.query("commit"); return null; }
    await client.query(`update public.creative_ai_jobs set status='processing',
      attempts=attempts+1,started_at=coalesce(started_at,now()),updated_at=now(),
      error_code=null where id=$1`,[job.id]);
    await client.query("commit");
    return {...job,attempts:job.attempts+1};
  } catch(error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

type ResponsePayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  usage?: {input_tokens?:number;output_tokens?:number;total_tokens?:number};
};

type AnalysisResult = {
  analysis: Record<string, unknown>;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

async function analyzeWithOpenAI(
  config: OpenAIProjectConfig, systemText: string, userText: string,
): Promise<AnalysisResult> {
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${config.apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:config.analysisModel,store:false,
      reasoning:{effort:"low"},
      input:[{role:"system",content:systemText},
        {role:"user",content:userText}],
      text:{format:{type:"json_schema",name:"creative_analysis",strict:true,schema}},
    }),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const responsePayload=await response.json() as ResponsePayload;
  return {
    analysis: JSON.parse(outputText(responsePayload)),
    inputTokens: responsePayload.usage?.input_tokens??null,
    outputTokens: responsePayload.usage?.output_tokens??null,
    totalTokens: responsePayload.usage?.total_tokens??null,
  };
}

async function analyzeWithAnthropic(
  config: AnthropicProjectConfig, systemText: string, userText: string,
): Promise<AnalysisResult> {
  const response=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"x-api-key":config.apiKey,"anthropic-version":"2023-06-01",
      "Content-Type":"application/json"},
    body:JSON.stringify({
      model:config.analysisModel,max_tokens:8192,
      system:`${systemText}\nResponda somente com um JSON válido, sem markdown, seguindo exatamente este esquema: ${JSON.stringify(schema)}`,
      messages:[{role:"user",content:userText}],
    }),
  });
  if (!response.ok) throw new Error(`anthropic_http_${response.status}`);
  const payload=await response.json() as {
    content?:Array<{type?:unknown;text?:unknown}>;
    usage?:{input_tokens?:number;output_tokens?:number};
  };
  const text=(payload.content??[]).find((item)=>item.type==="text" &&
    typeof item.text==="string")?.text;
  if (typeof text!=="string" || !text.trim()) throw new Error("analysis_output_missing");
  const cleaned=text.trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  const inputTokens=payload.usage?.input_tokens??null;
  const outputTokens=payload.usage?.output_tokens??null;
  return {
    analysis: JSON.parse(cleaned),
    inputTokens, outputTokens,
    totalTokens: inputTokens!==null && outputTokens!==null
      ? inputTokens+outputTokens : null,
  };
}

async function analyzeWithOpenRouter(
  config: OpenRouterProjectConfig, systemText: string, userText: string,
): Promise<AnalysisResult> {
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{Authorization:`Bearer ${config.apiKey}`,
      "Content-Type":"application/json"},
    body:JSON.stringify({
      model:config.analysisModel,
      messages:[
        {role:"system",content:`${systemText}\nResponda somente com um JSON válido, sem markdown, seguindo exatamente este esquema: ${JSON.stringify(schema)}`},
        {role:"user",content:userText}],
    }),
  });
  if (!response.ok) throw new Error(`openrouter_http_${response.status}`);
  const payload=await response.json() as {
    choices?:Array<{message?:{content?:unknown}}>;
    usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number};
  };
  const text=payload.choices?.[0]?.message?.content;
  if (typeof text!=="string" || !text.trim()) throw new Error("analysis_output_missing");
  const cleaned=text.trim().replace(/^```(?:json)?/i,"").replace(/```$/,"").trim();
  const inputTokens=payload.usage?.prompt_tokens??null;
  const outputTokens=payload.usage?.completion_tokens??null;
  return {
    analysis: JSON.parse(cleaned),
    inputTokens, outputTokens,
    totalTokens: payload.usage?.total_tokens
      ?? (inputTokens!==null && outputTokens!==null ? inputTokens+outputTokens : null),
  };
}

function outputText(payload: ResponsePayload) {
  if (typeof payload.output_text==="string") return payload.output_text;
  for (const item of payload.output??[]) for (const content of item.content??[])
    if (content.type==="output_text" && typeof content.text==="string") return content.text;
  throw new Error("analysis_output_missing");
}

export async function processCreativeAnalysis(pool:pg.Pool,maxAttempts=5) {
  const job=await claim(pool,maxAttempts);
  if (!job) return {claimed:0,completed:0,failed:0};
  try {
    const config=await loadProjectOpenAIConfig(pool,job.project_id);
    if (!config) throw new Error("openai_configuration_missing");
    await assertAiBudgetAvailable(pool,job.project_id,config.monthlyBudgetBrl);
    const performance=(await pool.query<{
      currency:string|null;ads:number;campaigns:number;spend:string;
      impressions:string;reach:string;clicks:string;first_date:string|null;
      last_date:string|null;
    }>(
      `select account.currency,count(distinct ad.id)::int ads,
              count(distinct ad.meta_campaign_id)::int campaigns,
              coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
              coalesce(sum(insight.impressions),0)::text impressions,
              coalesce(sum(insight.reach),0)::text reach,
              coalesce(sum(insight.clicks),0)::text clicks,
              min(insight.metric_date)::text first_date,max(insight.metric_date)::text last_date
         from public.creative_ad_links link
         join public.meta_ads ad on ad.id=link.meta_ad_id
         join public.meta_ad_accounts account on account.id=ad.meta_ad_account_id
         left join public.meta_ad_insights_daily insight on insight.meta_ad_id=ad.id
        where link.creative_version_id=$1
        group by account.currency`,
      [job.creative_version_id],
    )).rows;
    const performanceContext=performance.length
      ? `\n\nMétricas observadas dos anúncios explicitamente ligados a esta versão (não demonstram causalidade):\n${JSON.stringify(performance)}`
      : "\n\nNão há métricas Meta ligadas a esta versão. Não formule hipóteses de desempenho.";
    const systemText="Analise somente evidências presentes na transcrição e, quando fornecidas, métricas observadas. Não invente contexto ou resultados. Trate relações entre conteúdo e desempenho apenas como hipóteses, nunca como causalidade. Seja conciso e escreva em português do Brasil.";
    const userText=`Transcrição do criativo:\n${job.transcript.slice(0,100000)}${performanceContext}`;
    // D-172: provedor de analise configuravel (OpenAI, Claude ou OpenRouter),
    // com reserva automatica pelos outros provedores quando configurados.
    let result: AnalysisResult | undefined;
    let usedModel = config.analysisModel;
    let primaryError: unknown = null;
    const tryOpenAI = async () => {
      result = await analyzeWithOpenAI(config, systemText, userText);
      usedModel = config.analysisModel;
    };
    const tryAnthropic = async () => {
      const anthropic = await loadProjectAnthropicConfig(pool, job.project_id)
        .catch(() => null);
      if (!anthropic) throw new Error("anthropic_configuration_missing");
      result = await analyzeWithAnthropic(anthropic, systemText, userText);
      usedModel = anthropic.analysisModel;
    };
    const tryOpenRouter = async () => {
      const openrouter = await loadProjectOpenRouterConfig(pool, job.project_id)
        .catch(() => null);
      if (!openrouter) throw new Error("openrouter_configuration_missing");
      result = await analyzeWithOpenRouter(openrouter, systemText, userText);
      usedModel = openrouter.analysisModel;
    };
    const analysisAttempts = config.analysisProvider === "anthropic"
      ? [tryAnthropic, tryOpenAI, tryOpenRouter]
      : config.analysisProvider === "openrouter"
        ? [tryOpenRouter, tryOpenAI, tryAnthropic]
        : [tryOpenAI, tryAnthropic, tryOpenRouter];
    for (const attempt of analysisAttempts) {
      try {
        await attempt();
        primaryError = null;
        break;
      } catch (error) {
        if (!primaryError) primaryError = error;
        result = undefined;
      }
    }
    if (!result) throw primaryError ?? new Error("analysis_provider_failed");
    const analysis=result.analysis as {
      hook:string|null;promise:string|null;mechanism:string|null;cta:string|null;
      proof:string[];objections:string[];structure:string[];
      performance_hypotheses:string[];evidence:string[];confidence:number;tags:string[];
    };
    const pricing=await loadAiPricing(pool,job.project_id,usedModel,"creative_analysis");
    const inputTokens=result.inputTokens;
    const outputTokens=result.outputTokens;
    const estimatedCost=pricing && inputTokens!==null && outputTokens!==null
      ? analysisCostBrl(inputTokens,outputTokens,
          Number(pricing.input_cost_per_million_brl??0),
          Number(pricing.output_cost_per_million_brl??0))
      : null;
    const client=await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into public.creative_analyses (
          organization_id,project_id,creative_id,creative_version_id,job_id,
          model,prompt_version,hook,promise,mechanism,proof,objections,cta,
          structure,performance_hypotheses,evidence,confidence
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,
                  $14::jsonb,$15::jsonb,$16::jsonb,$17)
        on conflict (job_id) do nothing`,
        [job.organization_id,job.project_id,job.creative_id,job.creative_version_id,
         job.id,usedModel,job.prompt_version,analysis.hook,analysis.promise,
         analysis.mechanism,JSON.stringify(analysis.proof),JSON.stringify(analysis.objections),
         analysis.cta,JSON.stringify(analysis.structure),
         JSON.stringify(analysis.performance_hypotheses),JSON.stringify(analysis.evidence),
         analysis.confidence]);
      await client.query(
        `insert into public.ai_usage_records(organization_id,project_id,job_id,
         model,operation,input_tokens,output_tokens,total_tokens,
         estimated_cost_brl,pricing_version)
         values($1,$2,$3,$4,'creative_analysis',$5,$6,$7,$8,$9)
         on conflict(job_id,operation) do nothing`,
        [job.organization_id,job.project_id,job.id,usedModel,
         inputTokens,outputTokens,result.totalTokens,
         estimatedCost,pricing?.id??null],
      );
      for (const display of [...new Set<string>(analysis.tags)].slice(0,12)) {
        const normalized=normalizeTag(display);
        if (!normalized) continue;
        const tag=await client.query<{id:string}>(`insert into public.creative_tags
          (organization_id,project_id,name,normalized_name)
          values ($1,$2,$3,$4) on conflict (organization_id,project_id,normalized_name)
          do update set name=excluded.name returning id`,
          [job.organization_id,job.project_id,display.slice(0,80),normalized]);
        await client.query(`insert into public.creative_tag_assignments
          (organization_id,project_id,creative_id,creative_version_id,tag_id,source,
           confidence)
          values ($1,$2,$3,$4,$5,'ai',$6)
          on conflict do nothing`,
          [job.organization_id,job.project_id,job.creative_id,job.creative_version_id,
           tag.rows[0]!.id,analysis.confidence]);
      }
      await client.query(`update public.creative_ai_jobs set status='completed',
        model=$2,finished_at=now(),updated_at=now() where id=$1`,
        [job.id,usedModel]);
      await client.query(`insert into public.audit_logs
        (organization_id,project_id,actor_user_id,action,target_type,target_id,after)
        select $1,$2,requested_by_user_id,'creative_analysis_completed',
        'creative_version',$3,
        jsonb_build_object('jobId',$4::text,'model',$5::text)
        from public.creative_ai_jobs where id=$4::uuid`,
        [job.organization_id,job.project_id,job.creative_version_id,job.id,usedModel]);
      await client.query("commit");
    } catch(error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    return {claimed:1,completed:1,failed:0};
  } catch(error) {
    const budgetExhausted=error instanceof Error &&
      error.message==="ai_monthly_budget_exhausted";
    const terminal=budgetExhausted || job.attempts>=maxAttempts;
    const code=error instanceof Error && error.message.includes("429")
      ?"openai_rate_limited":budgetExhausted
        ?"ai_monthly_budget_exhausted":"creative_analysis_failed";
    await pool.query(`update public.creative_ai_jobs set status=$2::public.creative_ai_job_status,
      error_code=$3,finished_at=case when $2='failed_terminal' then now() end,
      updated_at=now() where id=$1`,
      [job.id,terminal?"failed_terminal":"failed_retryable",code]);
    return {claimed:1,completed:0,failed:1};
  }
}
