import type pg from "pg";

export function analysisCostBrl(inputTokens:number,outputTokens:number,inputPerMillion:number,outputPerMillion:number){
  return inputTokens/1_000_000*inputPerMillion+outputTokens/1_000_000*outputPerMillion;
}

export function transcriptionCostBrl(audioSeconds:number,audioPerMinute:number){
  return audioSeconds/60*audioPerMinute;
}

export async function assertAiBudgetAvailable(pool:pg.Pool,projectId:string,monthlyBudgetBrl:number){
  const result=await pool.query<{spent:string}>(
    `select coalesce(sum(estimated_cost_brl),0)::text spent
       from public.ai_usage_records
      where project_id=$1 and measured_at>=date_trunc('month',now())`,
    [projectId],
  );
  const spent=Number(result.rows[0]?.spent??0);
  if(spent>=monthlyBudgetBrl) throw new Error("ai_monthly_budget_exhausted");
  return spent;
}

export async function loadAiPricing(pool:pg.Pool,projectId:string,model:string,operation:"creative_analysis"|"creative_transcription"){
  const result=await pool.query<{
    id:string;input_cost_per_million_brl:string|null;
    output_cost_per_million_brl:string|null;audio_cost_per_minute_brl:string|null;
  }>(
    `select id,input_cost_per_million_brl,output_cost_per_million_brl,
            audio_cost_per_minute_brl
       from public.ai_project_pricing_versions
      where project_id=$1 and model=$2 and operation=$3
        and valid_from<=now() and (valid_until is null or valid_until>now())
      order by valid_from desc limit 1`,
    [projectId,model,operation],
  );
  return result.rows[0]??null;
}
