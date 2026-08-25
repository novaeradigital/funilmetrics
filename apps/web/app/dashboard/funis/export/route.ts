import {randomUUID} from "node:crypto";
import {createClient} from "../../../../lib/supabase/server";
import {getActiveProject} from "../../../../lib/active-project";
import {getDatabase} from "../../../../lib/database";

type Row={funnel_id:string;funnel_name:string;operation_type:string;status:string;
 starts_at:string|null;ends_at:string|null;position:number|null;step_name:string|null;
 event_key:string|null;sources:string|null;observed:number};
const cell=(value:string|number|null)=>`"${String(value??"").replaceAll('"','""')}"`;

export async function GET(){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)return new Response("Não autorizado",{status:401});
 const active=await getActiveProject(data.user.id);
 if(!active.project)return new Response("Projeto não disponível",{status:403});
 const db=getDatabase(),client=await db.pool.connect();
 try{
  await client.query("begin");
  const actor=(await client.query<{id:string;organization_id:string}>(`
   select app_user.id,project.organization_id from public.users app_user
   join public.projects project on project.id=$2
   join public.memberships membership on membership.user_id=app_user.id
    and membership.organization_id=project.organization_id
   where app_user.auth_user_id=$1 and
    (not exists(select 1 from public.project_memberships restricted
      where restricted.membership_id=membership.id)
     or exists(select 1 from public.project_memberships allowed
      where allowed.membership_id=membership.id and allowed.project_id=project.id))
   limit 1`,[data.user.id,active.project.id])).rows[0];
  if(!actor){await client.query("rollback");return new Response("Sem permissão",{status:403})}
  const rows=(await client.query<Row>(`with active_sources as (
   select link.funnel_id,string_agg(source.name,', ' order by source.name) sources
   from public.funnel_tracking_sources link join public.tracking_sources source
    on source.id=link.tracking_source_id
   where link.project_id=$1 and link.active group by link.funnel_id
  ),metrics as (
   select metric.funnel_id,metric.event_key,sum(metric.observed)::int observed from (
    select link.funnel_id,event.event_type event_key,
     count(distinct coalesce(event.visitor_id,event.session_id,event.external_event_id)) observed
    from public.funnel_tracking_sources link join public.funnels funnel
     on funnel.id=link.funnel_id and link.active
    join public.tracking_events event on event.tracking_source_id=link.tracking_source_id
     and not event.is_bot and (funnel.starts_at is null or event.occurred_at>=funnel.starts_at)
     and (funnel.ends_at is null or event.occurred_at<=funnel.ends_at)
    where link.project_id=$1 group by link.funnel_id,event.event_type
    union all
    select link.funnel_id,payment.type::text,
     count(distinct conversion.order_id)
    from public.funnel_tracking_sources link join public.funnels funnel
     on funnel.id=link.funnel_id and link.active
    join public.tracking_conversions conversion
     on conversion.tracking_source_id=link.tracking_source_id
    join public.normalized_payment_events payment on payment.order_id=conversion.order_id
     and payment.data_scope='production'
     and (funnel.starts_at is null or payment.occurred_at>=funnel.starts_at)
     and (funnel.ends_at is null or payment.occurred_at<=funnel.ends_at)
    where link.project_id=$1 group by link.funnel_id,payment.type
   ) metric group by metric.funnel_id,metric.event_key
  )
  select funnel.id funnel_id,funnel.name funnel_name,funnel.operation_type::text,
   funnel.status::text,funnel.starts_at::text,funnel.ends_at::text,step.position,
   step.name step_name,step.event_key,source.sources,coalesce(metric.observed,0)::int observed
  from public.funnels funnel left join public.funnel_steps step on step.funnel_id=funnel.id
  left join active_sources source on source.funnel_id=funnel.id
  left join metrics metric on metric.funnel_id=funnel.id and metric.event_key=step.event_key
  where funnel.project_id=$1 order by funnel.created_at desc,step.position`,[active.project.id])).rows;
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,reason,metadata,request_id)
   values($1,$2,$3,'funnel_definitions_exported','report','funnel_definitions_v1',
    'Exportação solicitada pelo usuário',$4::jsonb,$5)`,
   [actor.organization_id,active.project.id,actor.id,JSON.stringify({format:"csv",rows:rows.length,
    ruleVersion:"funnel_observed_v1",activeSourcesOnly:true}),randomUUID()]);
  await client.query("commit");
  const table:Array<Array<string|number|null>>=[
   ["funil_id","funil","tipo","status","inicio","fim","posicao","etapa","evento",
    "fontes_ativas","pessoas_ou_pedidos_observados"],
   ...rows.map(row=>[row.funnel_id,row.funnel_name,row.operation_type,row.status,
    row.starts_at,row.ends_at,row.position,row.step_name,row.event_key,row.sources,row.observed])
  ];
  return new Response(`\uFEFF${table.map(row=>row.map(cell).join(";")).join("\r\n")}`,
   {headers:{"Content-Type":"text/csv; charset=utf-8",
    "Content-Disposition":'attachment; filename="funil-metrics-funis.csv"',
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
 }catch(error){
  await client.query("rollback");console.error("funnel_definitions_export_failed",
   {error:error instanceof Error?error.message:"unknown"});
  return new Response("Não foi possível gerar a exportação",{status:500});
 }finally{client.release()}
}
