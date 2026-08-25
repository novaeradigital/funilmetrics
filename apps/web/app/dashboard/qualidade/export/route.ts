import {randomUUID} from "node:crypto";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";
import {processingStatusLabel,qualityErrorLabel,validationStatusLabel} from "../../../../lib/data-quality-labels";

const periods={"24h":1,"7d":7,"30d":30,all:null} as const;
const statuses=new Set(["all","normalized","duplicate","backlog","failed","quarantined","partial","unknown"]);
type Row={id:string;connection_name:string;external_event_id:string|null;
 external_event_name:string|null;processing_status:string;validation_status:string;
 processing_attempts:number;error_code:string|null;received_at:Date};
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;

export async function GET(request:Request){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)return new Response("Não autorizado",{status:401});
 const {project}=await getActiveProject(data.user.id);
 if(!project)return new Response("Projeto indisponível",{status:403});
 const searchParams=new URL(request.url).searchParams;
 const requested=searchParams.get("period")??"7d";
 const period=requested in periods?requested as keyof typeof periods:"7d";
 const requestedStatus=searchParams.get("status")??"all";
 const status=statuses.has(requestedStatus)?requestedStatus:"all";
 const connection=/^[0-9a-f-]{36}$/i.test(searchParams.get("connection")??"")
  ?searchParams.get("connection")!:"";
 const database=getDatabase(),client=await database.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string}>(`select app_user.id from public.users app_user
   join public.memberships membership on membership.user_id=app_user.id and membership.organization_id=$2
   where app_user.auth_user_id=$1 and (not exists(select 1 from public.project_memberships restricted
    where restricted.membership_id=membership.id) or exists(select 1 from public.project_memberships allowed
    where allowed.membership_id=membership.id and allowed.project_id=$3)) limit 1`,
   [data.user.id,project.organization_id,project.id])).rows[0];
  if(!actor){await client.query("rollback");return new Response("Sem permissão",{status:403})}
  const rows=(await client.query<Row>(`select event.id,connection.name connection_name,
   event.external_event_id,event.external_event_name,event.processing_status::text,
   event.validation_status::text,event.processing_attempts,event.error_code,event.received_at
   from public.raw_events event
   join public.connections connection on connection.id=event.connection_id
   where event.project_id=$1 and ($2::int is null or event.received_at>=now()-($2*interval '1 day'))
   and ($3='all' or ($3='normalized' and event.processing_status='normalized')
    or ($3='duplicate' and event.processing_status='duplicate')
    or ($3='backlog' and event.processing_status in ('received','queued','processing'))
    or ($3='failed' and event.processing_status in ('failed_retryable','failed_terminal'))
    or ($3='quarantined' and event.processing_status='quarantined')
    or ($3='partial' and event.validation_status='partial')
    or ($3='unknown' and event.validation_status='unknown_event'))
   and ($4='' or event.connection_id::text=$4)
   order by event.received_at desc,event.id limit 10000`,[project.id,periods[period],status,connection])).rows;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id) values($1,$2,$3,
   'data_quality_exported','report','raw_event_quality_v1','Exportação solicitada pelo usuário',
   $4::jsonb,$5)`,[project.organization_id,project.id,actor.id,
    JSON.stringify({format:"csv",period,status,connectionId:connection||null,rows:rows.length,limit:10000,
     fields:["event_id","connection","external_event_id","event_name","processing_status",
      "validation_status","processing_attempts","safe_error","received_at"],
     payloadIncluded:false}),randomUUID()]);
  await client.query("commit");
  const table:Array<Array<unknown>>=[["evento_id","conexao","id_externo","evento",
   "estado_processamento","estado_validacao","tentativas","falha_sanitizada","recebido_em"],
   ...rows.map(row=>[row.id,row.connection_name,row.external_event_id,row.external_event_name,
    processingStatusLabel(row.processing_status),validationStatusLabel(row.validation_status),
    row.processing_attempts,qualityErrorLabel(row.error_code),row.received_at.toISOString()])];
  return new Response(`\uFEFF${table.map(row=>row.map(cell).join(";")).join("\r\n")}`,{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":`attachment; filename="funil-metrics-qualidade-${period}-${status}.csv"`,
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch{
  await client.query("rollback");console.error("data_quality_export_failed");
  return new Response("Não foi possível exportar",{status:500});
 }finally{client.release()}
}
