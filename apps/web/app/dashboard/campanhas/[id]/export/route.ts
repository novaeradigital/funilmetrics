import {randomUUID} from "node:crypto";
import {createClient} from "../../../../../lib/supabase/server";
import {getDatabase} from "../../../../../lib/database";
import {getActiveProject} from "../../../../../lib/active-project";

const periods={"7d":7,"30d":30} as const;
type Row={metric_date:string;currency:string|null;account_id:string;account_name:string;
  campaign_id:string;campaign_name:string;ad_set_id:string;ad_set_name:string;
  ad_id:string;ad_name:string;creative_id:string|null;creative_name:string|null;
  spend:string;impressions:string;reach:string;clicks:string};
const cell=(value:string|number|null)=>`"${String(value??"").replaceAll('"','""')}"`;

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(id))return new Response("Campanha inválida",{status:400});
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)return new Response("Não autorizado",{status:401});
  const active=await getActiveProject(data.user.id);
  if(!active.project)return new Response("Projeto não disponível",{status:403});
  const requested=new URL(request.url).searchParams.get("period")??"30d";
  const periodKey=requested in periods?requested as keyof typeof periods:"30d";
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const actor=(await client.query<{user_id:string;organization_id:string}>(
      `select app_user.id user_id,project.organization_id
         from public.users app_user
         join public.projects project on project.id=$2
         join public.memberships membership
           on membership.user_id=app_user.id
          and membership.organization_id=project.organization_id
        where app_user.auth_user_id=$1
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=project.id))
        limit 1`,
      [data.user.id,active.project.id],
    )).rows[0];
    if(!actor){await client.query("rollback");return new Response("Sem permissão",{status:403});}
    const rows=(await client.query<Row>(
      `select insight.metric_date::text,account.currency,
              account.external_id account_id,account.name account_name,
              campaign.external_id campaign_id,campaign.name campaign_name,
              ad_set.external_id ad_set_id,ad_set.name ad_set_name,
              ad.external_id ad_id,ad.name ad_name,
              creative.external_id creative_id,creative.name creative_name,
              insight.spend::text,insight.impressions::text,
              insight.reach::text,insight.clicks::text
         from public.meta_ad_insights_daily insight
         join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
         join public.meta_campaigns campaign on campaign.id=insight.meta_campaign_id
         join public.meta_ad_sets ad_set on ad_set.id=insight.meta_ad_set_id
         join public.meta_ads ad on ad.id=insight.meta_ad_id
         left join public.meta_creatives creative on creative.id=ad.meta_creative_id
        where insight.project_id=$1 and campaign.id=$2
          and insight.metric_date>=current_date-$3::int+1
        order by insight.metric_date desc,ad_set.name,ad.name`,
      [active.project.id,id,periods[periodKey]],
    )).rows;
    if(!rows.length){
      const exists=(await client.query(
        `select 1 from public.meta_campaigns where id=$1 and project_id=$2`,
        [id,active.project.id],
      )).rowCount;
      if(!exists){await client.query("rollback");return new Response("Campanha não encontrada",{status:404});}
    }
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,reason,metadata,request_id)
       values($1,$2,$3,'meta_campaign_performance_exported','meta_campaign',$4,
              'Exportação solicitada pelo usuário',$5::jsonb,$6)`,
      [actor.organization_id,active.project.id,actor.user_id,id,
       JSON.stringify({format:"csv",period:periodKey,rows:rows.length,
         granularity:"ad_day",dataSource:"meta_ads"}),randomUUID()],
    );
    await client.query("commit");
    const table:Array<Array<string|number|null>>=[
      ["data","moeda","conta_id","conta","campanha_id","campanha","conjunto_id",
       "conjunto","anuncio_id","anuncio","criativo_id","criativo","investimento",
       "impressoes","alcance","cliques"],
      ...rows.map((row)=>[row.metric_date,row.currency,row.account_id,row.account_name,
        row.campaign_id,row.campaign_name,row.ad_set_id,row.ad_set_name,row.ad_id,
        row.ad_name,row.creative_id,row.creative_name,row.spend,row.impressions,
        row.reach,row.clicks]),
    ];
    const csv=`\uFEFF${table.map((row)=>row.map(cell).join(";")).join("\r\n")}`;
    return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="funil-metrics-campanha-${periodKey}.csv"`,
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }catch{
    await client.query("rollback");console.error("meta_campaign_performance_export_failed");
    return new Response("Não foi possível gerar a exportação",{status:500});
  }finally{client.release();}
}
