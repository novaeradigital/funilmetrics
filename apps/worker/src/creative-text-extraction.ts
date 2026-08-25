import type pg from "pg";
import mammoth from "mammoth";
import {loadProjectR2Config} from "./integration-credentials.js";
import {R2CreativeStorage} from "./r2-storage.js";

type Job={id:string;organization_id:string;project_id:string;creative_id:string;
  creative_version_id:string;attempts:number;object_key:string;mime_type:string};

async function claim(pool:pg.Pool,maxAttempts:number){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const result=await client.query<Job>(
      `select job.id,job.organization_id,job.project_id,job.creative_id,
       job.creative_version_id,job.attempts,asset.object_key,asset.mime_type
       from public.creative_ai_jobs job
       join public.creative_versions version on version.id=job.creative_version_id
       join public.creative_assets asset on asset.id=version.asset_id
       where job.kind='text_extraction'
        and job.status in ('pending','failed_retryable') and job.attempts<$1
        and asset.available_at is not null and asset.malware_status='clean'
        and asset.mime_type in ('text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
       order by job.created_at for update of job skip locked limit 1`,[maxAttempts]);
    const job=result.rows[0];
    if(!job){await client.query("commit");return null;}
    await client.query(`update public.creative_ai_jobs set status='processing',
      attempts=attempts+1,started_at=coalesce(started_at,now()),updated_at=now(),
      error_code=null where id=$1`,[job.id]);
    await client.query("commit");
    return {...job,attempts:job.attempts+1};
  }catch(error){await client.query("rollback");throw error;}
  finally{client.release();}
}

async function readLimited(stream:NodeJS.ReadableStream,maxBytes=12*1024*1024){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of stream){
    const buffer=Buffer.from(chunk);size+=buffer.length;
    if(size>maxBytes) throw new Error("text_extraction_file_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function processCreativeTextExtraction(pool:pg.Pool,maxAttempts=5){
  const job=await claim(pool,maxAttempts);
  if(!job)return {claimed:0,completed:0,failed:0};
  try{
    const r2=await loadProjectR2Config(pool,job.project_id);
    if(!r2)throw new Error("r2_configuration_missing");
    const bytes=await readLimited(await new R2CreativeStorage(r2).getPrivateObject(job.object_key));
    const extracted=job.mime_type==="text/plain"
      ? {text:bytes.toString("utf8"),method:"plain_text_utf8",warnings:[] as string[]}
      : await mammoth.extractRawText({buffer:bytes}).then((result)=>({
          text:result.value,method:"docx_raw_text",
          warnings:result.messages.map((message)=>message.type).slice(0,20)}));
    const text=extracted.text.split("\0").join("").trim();
    if(!text)throw new Error("text_extraction_empty");
    const client=await pool.connect();
    try{
      await client.query("begin");
      await client.query(
        `insert into public.creative_text_extractions(
         organization_id,project_id,creative_id,creative_version_id,job_id,
         method,text,evidence) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         on conflict(job_id) do nothing`,
        [job.organization_id,job.project_id,job.creative_id,
         job.creative_version_id,job.id,extracted.method,text,
         JSON.stringify({mimeType:job.mime_type,characterCount:text.length,
           warnings:extracted.warnings})]);
      await client.query(`update public.creative_ai_jobs set status='completed',
        finished_at=now(),updated_at=now() where id=$1`,[job.id]);
      await client.query(
        `insert into public.audit_logs(organization_id,project_id,actor_user_id,
         action,target_type,target_id,after)
         select $1,$2,requested_by_user_id,'creative_text_extraction_completed',
         'creative_version',$3,jsonb_build_object('jobId',$4::text,
         'method',$5::text,'characterCount',$6::int)
         from public.creative_ai_jobs where id=$4::uuid`,
        [job.organization_id,job.project_id,job.creative_version_id,job.id,
         extracted.method,text.length]);
      await client.query("commit");
    }catch(error){await client.query("rollback");throw error;}
    finally{client.release();}
    return {claimed:1,completed:1,failed:0};
  }catch(error){
    const terminal=job.attempts>=maxAttempts;
    const message=error instanceof Error?error.message:"unknown";
    const code=message.includes("too_large")?"text_extraction_file_too_large":
      message.includes("empty")?"text_extraction_empty":
      message.includes("r2_")?"r2_configuration_missing":"text_extraction_failed";
    await pool.query(`update public.creative_ai_jobs set status=$2::public.creative_ai_job_status,
      error_code=$3,finished_at=case when $2='failed_terminal' then now() end,
      updated_at=now() where id=$1`,
      [job.id,terminal?"failed_terminal":"failed_retryable",code]);
    return {claimed:1,completed:0,failed:1};
  }
}
