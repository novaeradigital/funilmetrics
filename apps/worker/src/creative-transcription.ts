import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import type pg from "pg";
import { loadProjectGroqConfig, loadProjectOpenAIConfig, loadProjectR2Config } from "./integration-credentials.js";
import { R2CreativeStorage } from "./r2-storage.js";
import { assertAiBudgetAvailable, loadAiPricing, transcriptionCostBrl } from "./ai-budget.js";

type ClaimedJob = {
  id: string;
  organization_id: string;
  project_id: string;
  creative_id: string;
  creative_version_id: string;
  model: string;
  attempts: number;
  object_key: string;
  mime_type: string;
};

function runFfmpeg(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", output,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error = `${error}${String(chunk)}`.slice(-2_000);
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg_failed_${code}:${error}`)),
    );
  });
}

function audioDurationSeconds(input:string){
  return new Promise<number>((resolve,reject)=>{
    const child=spawn("ffprobe",["-v","error","-show_entries","format=duration",
      "-of","default=noprint_wrappers=1:nokey=1",input],
      {stdio:["ignore","pipe","pipe"]});
    let output=""; let error="";
    child.stdout.on("data",(chunk)=>{output+=String(chunk);});
    child.stderr.on("data",(chunk)=>{error=`${error}${String(chunk)}`.slice(-1000);});
    child.once("error",reject);
    child.once("close",(code)=>{
      const duration=Number(output.trim());
      if(code===0 && Number.isFinite(duration) && duration>0)resolve(duration);
      else reject(new Error(`ffprobe_failed_${code}:${error}`));
    });
  });
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  if (message.includes("ffmpeg")) return "audio_extraction_failed";
  if (message.includes("openai_configuration")) return "openai_configuration_missing";
  if (message.includes("r2_")) return "r2_configuration_missing";
  if (message.includes("429")) return "openai_rate_limited";
  if (message.includes("ai_monthly_budget_exhausted")) return "ai_monthly_budget_exhausted";
  if (message.includes("401") || message.includes("403")) return "openai_unauthorized";
  if (message.includes("413")) return "transcription_file_too_large";
  return "transcription_failed";
}

async function claim(pool: pg.Pool, maxAttempts: number) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<ClaimedJob>(
      `select job.id, job.organization_id, job.project_id, job.creative_id,
              job.creative_version_id, job.model, job.attempts,
              asset.object_key, asset.mime_type
         from public.creative_ai_jobs job
         join public.creative_versions version
           on version.id = job.creative_version_id
         join public.creative_assets asset on asset.id = version.asset_id
        where job.kind = 'transcription'
          and job.status in ('pending', 'failed_retryable')
          and job.attempts < $1
          and asset.available_at is not null
          and asset.malware_status = 'clean'
        order by job.created_at
        for update of job skip locked
        limit 1`,
      [maxAttempts],
    );
    const job = result.rows[0];
    if (!job) {
      await client.query("commit");
      return null;
    }
    await client.query(
      `update public.creative_ai_jobs
          set status = 'processing', attempts = attempts + 1,
              started_at = coalesce(started_at, now()), updated_at = now(),
              error_code = null
        where id = $1`,
      [job.id],
    );
    await client.query("commit");
    return { ...job, attempts: job.attempts + 1 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function transcribe(apiKey: string, model: string, audioPath: string, endpoint: string) {
  const form = new FormData();
  const bytes = await readFile(audioPath);
  form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");
  form.append("model", model);
  form.append("response_format", "json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`transcription_http_${response.status}`);
    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      segments?: unknown;
    };
    if (!payload.text?.trim()) throw new Error("transcription_empty");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function processCreativeTranscription(
  pool: pg.Pool,
  maxAttempts = 5,
) {
  const job = await claim(pool, maxAttempts);
  if (!job) return { claimed: 0, completed: 0, failed: 0 };
  const work = await mkdtemp(join(tmpdir(), "funil-transcription-"));
  let stage = "configuration";
  try {
    const [openai, r2] = await Promise.all([
      loadProjectOpenAIConfig(pool, job.project_id),
      loadProjectR2Config(pool, job.project_id),
    ]);
    if (!openai) throw new Error("openai_configuration_missing");
    if (!r2) throw new Error("r2_configuration_missing");
    await assertAiBudgetAvailable(pool,job.project_id,openai.monthlyBudgetBrl);
    const source = join(work, "source");
    const audio = join(work, "audio.mp3");
    const storage = new R2CreativeStorage(r2);
    stage = "download";
    await pipeline(
      await storage.getPrivateObject(job.object_key),
      createWriteStream(source),
    );
    stage = "audio_extraction";
    await runFfmpeg(source, audio);
    const audioInfo = await stat(audio);
    if (audioInfo.size <= 0) throw new Error("transcription_empty");
    const audioSeconds=await audioDurationSeconds(audio);
    // D-172: provedor de transcricao configuravel (Groq ou OpenAI), com
    // reserva automatica pelo outro provedor quando ele esta configurado.
    const groqConfig = await loadProjectGroqConfig(pool, job.project_id);
    type TxAttempt = {
      provider: "groq" | "openai"; apiKey: string; model: string;
      endpoint: string; maxBytes: number;
    };
    const openaiAttempt: TxAttempt = {
      provider: "openai", apiKey: openai.apiKey, model: openai.transcriptionModel,
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      maxBytes: 24 * 1024 * 1024,
    };
    const groqAttempt: TxAttempt | null = groqConfig ? {
      provider: "groq", apiKey: groqConfig.apiKey, model: groqConfig.transcriptionModel,
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
      maxBytes: 100 * 1024 * 1024,
    } : null;
    const attempts: TxAttempt[] = openai.transcriptionProvider === "groq" && groqAttempt
      ? [groqAttempt, openaiAttempt]
      : groqAttempt ? [openaiAttempt, groqAttempt] : [openaiAttempt];
    let transcript: Awaited<ReturnType<typeof transcribe>> | null = null;
    let usedModel = openai.transcriptionModel;
    let lastError: unknown = null;
    for (const attempt of attempts) {
      if (audioInfo.size > attempt.maxBytes) {
        lastError = new Error("transcription_http_413");
        continue;
      }
      stage = attempt.provider;
      try {
        transcript = await transcribe(attempt.apiKey, attempt.model, audio, attempt.endpoint);
        usedModel = attempt.model;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!transcript) throw lastError ?? new Error("transcription_failed");
    const pricing=await loadAiPricing(pool,job.project_id,
      usedModel,"creative_transcription");
    const estimatedCost=pricing
      ? transcriptionCostBrl(audioSeconds,Number(pricing.audio_cost_per_minute_brl??0))
      : null;
    stage = "persistence";
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into public.creative_transcripts (
           organization_id, project_id, creative_id, creative_version_id,
           job_id, model, language, text, segments
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         on conflict (job_id) do nothing`,
        [
          job.organization_id,
          job.project_id,
          job.creative_id,
          job.creative_version_id,
          job.id,
          usedModel,
          transcript.language ?? null,
          transcript.text!.trim(),
          transcript.segments ? JSON.stringify(transcript.segments) : null,
        ],
      );
      await client.query(
        `insert into public.ai_usage_records (
           organization_id,project_id,job_id,model,operation,audio_seconds,
           estimated_cost_brl,pricing_version
         ) values ($1,$2,$3,$4,'creative_transcription',$5,$6,$7)
         on conflict(job_id,operation) do nothing`,
        [job.organization_id,job.project_id,job.id,usedModel,
         audioSeconds,estimatedCost,pricing?.id??null],
      );
      await client.query(
        `update public.creative_ai_jobs
            set status = 'completed', model = $2, error_code = null,
                finished_at = now(), updated_at = now()
          where id = $1`,
        [job.id, usedModel],
      );
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         )
         select $1, $2, requested_by_user_id,
                'creative_transcription_completed',
                'creative_version', $3,
                jsonb_build_object('jobId', $4::text, 'model', $5::text)
           from public.creative_ai_jobs where id = $4::uuid`,
        [
          job.organization_id,
          job.project_id,
          job.creative_version_id,
          job.id,
          usedModel,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { claimed: 1, completed: 1, failed: 0 };
  } catch (error) {
    const budgetExhausted=error instanceof Error &&
      error.message==="ai_monthly_budget_exhausted";
    const terminal = budgetExhausted || job.attempts >= maxAttempts;
    const mapped = safeErrorCode(error);
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 20)
        : null;
    await pool.query(
      `update public.creative_ai_jobs
          set status = $2::public.creative_ai_job_status,
              error_code = $3, finished_at = case when $2 = 'failed_terminal' then now() end,
              updated_at = now()
        where id = $1`,
      [
        job.id,
        terminal ? "failed_terminal" : "failed_retryable",
        mapped === "transcription_failed"
          ? `transcription_${stage}_${databaseCode ?? "failed"}`
          : mapped,
      ],
    );
    return { claimed: 1, completed: 0, failed: 1 };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
