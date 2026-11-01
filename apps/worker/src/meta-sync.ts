import type pg from "pg";
import {loadMetaConnectionAccessToken} from "./integration-credentials.js";
import {markMetaAuthorizationExpired,refreshMetaOAuthTokenIfNeeded} from "./meta-token.js";

const graphVersion="v25.0";
type Run={id:string;organization_id:string;project_id:string;connection_id:string;
  attempts:number;sync_scope:string;configuration:Record<string,unknown>};
type Counts={accounts:number;campaigns:number;adSets:number;ads:number;
  creatives:number;insights:number};

function calendarDateInTimeZone(now:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(now);
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function metaInsightTimeRange(now:Date,timeZone:string,days=30){
  const until=calendarDateInTimeZone(now,timeZone||"UTC");
  const [year=1970,month=1,day=1]=until.split("-").map(Number);
  const sinceDate=new Date(Date.UTC(year,month-1,day-(days-1)));
  return {since:sinceDate.toISOString().slice(0,10),until};
}

export type MetaVideoMetrics={
  views3s:number|null;thruplay:number|null;p25:number|null;
  p50:number|null;p75:number|null;p100:number|null;
};

function watchedActionsTotal(value:unknown):number|null{
  if(!Array.isArray(value))return null;
  let total=0;let found=false;
  for(const item of value){
    if(!item||typeof item!=="object")continue;
    const raw=Number((item as Record<string,unknown>).value??NaN);
    if(!Number.isFinite(raw))continue;
    total+=raw;found=true;
  }
  return found?total:null;
}

function actionTypeTotal(actions:unknown,actionType:string):number|null{
  if(!Array.isArray(actions))return null;
  let total=0;let found=false;
  for(const item of actions){
    if(!item||typeof item!=="object")continue;
    const entry=item as Record<string,unknown>;
    if(entry.action_type!==actionType)continue;
    const raw=Number(entry.value??NaN);
    if(!Number.isFinite(raw))continue;
    total+=raw;found=true;
  }
  return found?total:null;
}

/**
 * Metricas de video de um insight diario (D-160). Os campos
 * video_*_watched_actions chegam como arrays de {action_type, value};
 * a visualizacao de 3 segundos e a acao video_view do array actions.
 * Campo ausente vira null (indisponivel), nunca zero.
 */
export function parseMetaVideoMetrics(insight:Record<string,unknown>):MetaVideoMetrics{
  return {
    views3s:actionTypeTotal(insight.actions,"video_view"),
    thruplay:watchedActionsTotal(insight.video_thruplay_watched_actions),
    p25:watchedActionsTotal(insight.video_p25_watched_actions),
    p50:watchedActionsTotal(insight.video_p50_watched_actions),
    p75:watchedActionsTotal(insight.video_p75_watched_actions),
    p100:watchedActionsTotal(insight.video_p100_watched_actions),
  };
}

class MetaHttpError extends Error{
  constructor(readonly status:number,detail?:string){
    super(`meta_http_${status}${detail?`:${detail.slice(0,180)}`:""}`);
  }
}

function errorCode(error:unknown){
  if(error instanceof MetaHttpError)return `meta_http_${error.status}`;
  if(error instanceof Error&&/^[a-z0-9_]+$/i.test(error.message))return error.message;
  return "meta_sync_failed";
}

function retryable(error:unknown){
  if(error instanceof MetaHttpError){
    return error.status===429||error.status>=500||error.message.includes(":17:");
  }
  if(error instanceof Error&&[
    "meta_configuration_missing","meta_allowlist_empty",
    "integration_vault_disabled","integration_vault_key_invalid",
  ].includes(error.message))return false;
  return true;
}

async function claim(pool:pg.Pool){
  const client=await pool.connect();
  try{
    await client.query("begin");
    const result=await client.query<Run>(
      `select run.id,run.organization_id,run.project_id,run.connection_id,
              run.attempts,run.sync_scope,connection.configuration
         from public.meta_sync_runs run
         join public.connections connection on connection.id=run.connection_id
        where run.status in ('queued','failed_retryable')
          and run.next_attempt_at<=now()
        order by run.created_at limit 1 for update of run skip locked`,
    );
    const row=result.rows[0];
    if(!row){await client.query("commit");return null}
    await client.query(
      `update public.meta_sync_runs set status='running',attempts=attempts+1,
              started_at=coalesce(started_at,now()),error_code=null,updated_at=now()
        where id=$1`,
      [row.id],
    );
    await client.query("commit");
    return {...row,attempts:row.attempts+1};
  }catch(error){await client.query("rollback");throw error}
  finally{client.release()}
}

function graphClient(token:string){
  const read=async(path:string)=>{
    const response=await fetch(`https://graph.facebook.com/${graphVersion}/${path}`,{
      headers:{Authorization:`Bearer ${token}`},
      signal:AbortSignal.timeout(30_000),
    });
    if(!response.ok){
      const payload=await response.json().catch(()=>null) as {
        error?:{code?:number;type?:string;message?:string}
      }|null;
      const detail=[
        payload?.error?.code,
        payload?.error?.type,
        payload?.error?.message,
      ].filter(Boolean).join(":");
      throw new MetaHttpError(response.status,detail);
    }
    return response.json() as Promise<Record<string,unknown>>;
  };
  const readAll=async(path:string)=>{
    const items:Record<string,unknown>[]=[];let after="";
    for(let page=0;page<20;page+=1){
      const separator=path.includes("?")?"&":"?";
      const payload=await read(`${path}${separator}limit=100${after
        ?`&after=${encodeURIComponent(after)}`:""}`);
      const data=Array.isArray(payload.data)?payload.data:[];
      items.push(...data.filter((item):item is Record<string,unknown> =>
        Boolean(item)&&typeof item==="object"));
      const paging=payload.paging as Record<string,unknown>|undefined;
      const cursors=paging?.cursors as Record<string,unknown>|undefined;
      const next=String(cursors?.after??"");
      if(!paging?.next||!next||next===after)break;
      after=next;
    }
    return items;
  };
  return {read,readAll};
}

async function synchronize(pool:pg.Pool,run:Run){
  await refreshMetaOAuthTokenIfNeeded(pool,{id:run.connection_id,projectId:run.project_id,organizationId:run.organization_id}).catch(()=>false);
  const token=await loadMetaConnectionAccessToken(pool,run.connection_id);
  if(!token)throw new Error("meta_configuration_missing");
  const allowlist=String(run.configuration.adAccountAllowlist??"")
    .split(",").map(item=>item.trim()).filter(Boolean);
  if(!allowlist.length)throw new Error("meta_allowlist_empty");
  const graph=graphClient(token);
  const counts:Counts={accounts:0,campaigns:0,adSets:0,ads:0,creatives:0,insights:0};
  const quick=run.sync_scope==="insights";
  for(const accountId of allowlist){
    const account=await graph.read(
      `${encodeURIComponent(accountId)}?fields=id,name,account_status,currency,timezone_name`);
    const accountRow=await pool.query<{id:string;currency:string}>(
      `insert into public.meta_ad_accounts(
         organization_id,project_id,connection_id,external_id,name,account_status,
         currency,timezone_name,currency_status,currency_source,currency_confirmed_at,
         last_synced_at,updated_at
       ) values($1,$2,$3,$4,$5,$6,$7,$8,
         case when nullif($7,'') is null then 'unconfirmed' else 'confirmed_provider' end,
         case when nullif($7,'') is null then null else 'meta_api' end,
         case when nullif($7,'') is null then null else now() end,now(),now())
       on conflict(project_id,external_id) do update set
         connection_id=excluded.connection_id,name=excluded.name,
         account_status=excluded.account_status,
         currency=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency else excluded.currency end,
         currency_status=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_status else excluded.currency_status end,
         currency_source=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_source else excluded.currency_source end,
         currency_confirmed_at=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_confirmed_at else excluded.currency_confirmed_at end,
         timezone_name=excluded.timezone_name,last_synced_at=now(),updated_at=now()
       returning id,currency`,
      [run.organization_id,run.project_id,run.connection_id,
       String(account.id??accountId),String(account.name??accountId),
       Number(account.account_status??0),String(account.currency??""),
       String(account.timezone_name??"")],
    );
    const localAccountId=accountRow.rows[0]?.id;
    const effectiveCurrency=accountRow.rows[0]?.currency??String(account.currency??"");
    if(!localAccountId)throw new Error("meta_account_upsert_failed");
    counts.accounts+=1;
    const catalogFresh=(await pool.query<{fresh:boolean}>(
      `select exists(
         select 1 from public.meta_ads
          where project_id=$1 and meta_ad_account_id=$2
            and last_synced_at>=now()-interval '6 hours'
       ) fresh`,
      [run.project_id,localAccountId],
    )).rows[0]?.fresh??false;
    if(!catalogFresh&&!quick){
    const campaigns=await graph.readAll(
      `${encodeURIComponent(accountId)}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget`);
    for(const campaign of campaigns){
      if(!campaign.id)continue;
      const campaignRow=await pool.query<{id:string}>(
        `insert into public.meta_campaigns(
           organization_id,project_id,meta_ad_account_id,external_id,name,status,
           effective_status,objective,daily_budget_minor,lifetime_budget_minor,last_synced_at,updated_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
         on conflict(project_id,external_id) do update set
           meta_ad_account_id=excluded.meta_ad_account_id,name=excluded.name,
           status=excluded.status,effective_status=excluded.effective_status,
           objective=excluded.objective,daily_budget_minor=excluded.daily_budget_minor,
           lifetime_budget_minor=excluded.lifetime_budget_minor,last_synced_at=now(),updated_at=now()
         returning id`,
        [run.organization_id,run.project_id,localAccountId,String(campaign.id),
         String(campaign.name??"Sem nome"),String(campaign.status??""),
         String(campaign.effective_status??""),String(campaign.objective??""),
         campaign.daily_budget?String(campaign.daily_budget):null,
         campaign.lifetime_budget?String(campaign.lifetime_budget):null],
      );
      const localCampaignId=campaignRow.rows[0]?.id;
      if(!localCampaignId)continue;
      counts.campaigns+=1;
      const adSets=await graph.readAll(
        `${encodeURIComponent(String(campaign.id))}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal`);
      for(const adSet of adSets){
        if(!adSet.id)continue;
        const adSetRow=await pool.query<{id:string}>(
          `insert into public.meta_ad_sets(
             organization_id,project_id,meta_ad_account_id,meta_campaign_id,
             external_id,name,status,effective_status,daily_budget_minor,
             lifetime_budget_minor,optimization_goal,last_synced_at,updated_at
           ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
           on conflict(project_id,external_id) do update set
             meta_ad_account_id=excluded.meta_ad_account_id,
             meta_campaign_id=excluded.meta_campaign_id,name=excluded.name,
             status=excluded.status,effective_status=excluded.effective_status,
             daily_budget_minor=excluded.daily_budget_minor,
             lifetime_budget_minor=excluded.lifetime_budget_minor,
             optimization_goal=excluded.optimization_goal,
             last_synced_at=now(),updated_at=now() returning id`,
          [run.organization_id,run.project_id,localAccountId,localCampaignId,
           String(adSet.id),String(adSet.name??"Sem nome"),String(adSet.status??""),
           String(adSet.effective_status??""),adSet.daily_budget?String(adSet.daily_budget):null,
           adSet.lifetime_budget?String(adSet.lifetime_budget):null,
           String(adSet.optimization_goal??"")],
        );
        const localAdSetId=adSetRow.rows[0]?.id;
        if(!localAdSetId)continue;
        counts.adSets+=1;
        const ads=await graph.readAll(
          `${encodeURIComponent(String(adSet.id))}/ads?fields=id,name,status,effective_status,creative{id,name,thumbnail_url,image_url,object_story_spec}`);
        for(const ad of ads){
          if(!ad.id)continue;
          const creative=ad.creative&&typeof ad.creative==="object"
            ? ad.creative as Record<string,unknown>:null;
          let localCreativeId:string|null=null;
          if(creative?.id){
            const result=await pool.query<{id:string}>(
              `insert into public.meta_creatives(
                 organization_id,project_id,meta_ad_account_id,external_id,name,
                 thumbnail_url,image_url,object_story_spec,last_synced_at,updated_at
               ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now(),now())
               on conflict(project_id,external_id) do update set
                 meta_ad_account_id=excluded.meta_ad_account_id,name=excluded.name,
                 thumbnail_url=excluded.thumbnail_url,image_url=excluded.image_url,
                 object_story_spec=excluded.object_story_spec,
                 last_synced_at=now(),updated_at=now() returning id`,
              [run.organization_id,run.project_id,localAccountId,String(creative.id),
               String(creative.name??""),String(creative.thumbnail_url??""),
               String(creative.image_url??""),
               JSON.stringify(creative.object_story_spec??null)],
            );
            localCreativeId=result.rows[0]?.id??null;counts.creatives+=1;
          }
          await pool.query(
            `insert into public.meta_ads(
               organization_id,project_id,meta_ad_account_id,meta_campaign_id,
               meta_ad_set_id,meta_creative_id,external_id,name,status,
               effective_status,last_synced_at,updated_at
             ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
             on conflict(project_id,external_id) do update set
               meta_ad_account_id=excluded.meta_ad_account_id,
               meta_campaign_id=excluded.meta_campaign_id,
               meta_ad_set_id=excluded.meta_ad_set_id,
               meta_creative_id=excluded.meta_creative_id,name=excluded.name,
               status=excluded.status,effective_status=excluded.effective_status,
               last_synced_at=now(),updated_at=now()`,
            [run.organization_id,run.project_id,localAccountId,localCampaignId,
             localAdSetId,localCreativeId,String(ad.id),String(ad.name??"Sem nome"),
             String(ad.status??""),String(ad.effective_status??"")],
          );
          counts.ads+=1;
        }
      }
    }
    }
    // `date_preset=last_30d` may omit the current account day. Requesting an
    // explicit inclusive range is required for intraday spend reconciliation.
    // Recent dates are intentionally fetched again because Meta can revise them.
    const insightRange=metaInsightTimeRange(
      new Date(),String(account.timezone_name??"UTC"),quick?3:30,
    );
    const insights=await graph.readAll(
      `${encodeURIComponent(accountId)}/insights?fields=campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,spend,impressions,reach,clicks,actions,action_values,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions&level=ad&time_increment=1&time_range=${encodeURIComponent(JSON.stringify(insightRange))}`);
    for(const insight of insights){
      if(!insight.ad_id||!insight.date_start)continue;
      let ids=(await pool.query<{ad_id:string;ad_set_id:string;campaign_id:string}>(
        `select id ad_id,meta_ad_set_id ad_set_id,meta_campaign_id campaign_id
           from public.meta_ads where project_id=$1 and external_id=$2 limit 1`,
        [run.project_id,String(insight.ad_id)],
      )).rows[0];
      if(!ids&&insight.campaign_id&&insight.adset_id){
        const campaign=(await pool.query<{id:string}>(
          `insert into public.meta_campaigns(
             organization_id,project_id,meta_ad_account_id,external_id,name,
             last_synced_at,updated_at
           ) values($1,$2,$3,$4,$5,now(),now())
           on conflict(project_id,external_id) do update set
             name=excluded.name,meta_ad_account_id=excluded.meta_ad_account_id,
             last_synced_at=now(),updated_at=now() returning id`,
          [run.organization_id,run.project_id,localAccountId,
           String(insight.campaign_id),String(insight.campaign_name??"Campanha histórica")],
        )).rows[0];
        if(!campaign?.id)continue;
        const adSet=(await pool.query<{id:string}>(
          `insert into public.meta_ad_sets(
             organization_id,project_id,meta_ad_account_id,meta_campaign_id,
             external_id,name,last_synced_at,updated_at
           ) values($1,$2,$3,$4,$5,$6,now(),now())
           on conflict(project_id,external_id) do update set
             name=excluded.name,meta_ad_account_id=excluded.meta_ad_account_id,
             meta_campaign_id=excluded.meta_campaign_id,last_synced_at=now(),
             updated_at=now() returning id`,
          [run.organization_id,run.project_id,localAccountId,campaign?.id,
           String(insight.adset_id),String(insight.adset_name??"Conjunto histórico")],
        )).rows[0];
        if(!adSet?.id)continue;
        const ad=(await pool.query<{id:string}>(
          `insert into public.meta_ads(
             organization_id,project_id,meta_ad_account_id,meta_campaign_id,
             meta_ad_set_id,external_id,name,last_synced_at,updated_at
           ) values($1,$2,$3,$4,$5,$6,$7,now(),now())
           on conflict(project_id,external_id) do update set
             name=excluded.name,meta_ad_account_id=excluded.meta_ad_account_id,
             meta_campaign_id=excluded.meta_campaign_id,
             meta_ad_set_id=excluded.meta_ad_set_id,last_synced_at=now(),
             updated_at=now() returning id`,
          [run.organization_id,run.project_id,localAccountId,campaign?.id,adSet?.id,
           String(insight.ad_id),String(insight.ad_name??"Anúncio histórico")],
        )).rows[0];
        if(campaign?.id&&adSet?.id&&ad?.id){
          ids={campaign_id:campaign.id,ad_set_id:adSet.id,ad_id:ad.id};
        }
      }
      if(!ids)continue;
      const video=parseMetaVideoMetrics(insight);
      await pool.query(
        `insert into public.meta_ad_insights_daily(
           organization_id,project_id,meta_ad_account_id,meta_campaign_id,
           meta_ad_set_id,meta_ad_id,external_ad_id,metric_date,currency,spend,
           spend_original,original_currency,conversion_status,
           impressions,reach,clicks,actions,action_values,raw_metric,
           video_views_3s,video_thruplay_views,video_p25_views,
           video_p50_views,video_p75_views,video_p100_views,
           last_synced_at,updated_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$10,$9,
                  case when nullif($9,'') is null then 'missing_currency'::public.currency_conversion_status
                       else 'pending_rate'::public.currency_conversion_status end,
                  $11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,now(),now())
         on conflict(project_id,external_ad_id,metric_date) do update set
           meta_ad_account_id=excluded.meta_ad_account_id,
           meta_campaign_id=excluded.meta_campaign_id,
           meta_ad_set_id=excluded.meta_ad_set_id,meta_ad_id=excluded.meta_ad_id,
           currency=excluded.currency,spend=excluded.spend,
           spend_original=case when meta_ad_insights_daily.spend_original is null then null
             else excluded.spend_original end,
           original_currency=case when meta_ad_insights_daily.spend_original is null then null
             else excluded.original_currency end,
           conversion_status=case when meta_ad_insights_daily.exchange_rate is not null
             and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
             and meta_ad_insights_daily.base_currency is not null
             then meta_ad_insights_daily.conversion_status
             when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             then excluded.conversion_status else meta_ad_insights_daily.conversion_status end,
           spend_base=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             then case when meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null
               then round(excluded.spend_original*meta_ad_insights_daily.exchange_rate,6)
               else null end else meta_ad_insights_daily.spend_base end,
           base_currency=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.base_currency end,
           exchange_rate=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.exchange_rate end,
           exchange_rate_date=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.exchange_rate_date end,
           exchange_rate_source=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.exchange_rate_source end,
           exchange_rate_source_version=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.exchange_rate_source_version end,
           conversion_rule_version=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.conversion_rule_version end,
           conversion_error_code=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.conversion_error_code end,
           converted_at=case when meta_ad_insights_daily.spend_original is not null and
             (meta_ad_insights_daily.spend is distinct from excluded.spend
             or meta_ad_insights_daily.original_currency is distinct from excluded.original_currency)
             and not (meta_ad_insights_daily.exchange_rate is not null
               and meta_ad_insights_daily.original_currency is not distinct from excluded.original_currency
               and meta_ad_insights_daily.base_currency is not null)
             then null else meta_ad_insights_daily.converted_at end,
           impressions=excluded.impressions,reach=excluded.reach,
           clicks=excluded.clicks,actions=excluded.actions,
           video_views_3s=excluded.video_views_3s,
           video_thruplay_views=excluded.video_thruplay_views,
           video_p25_views=excluded.video_p25_views,
           video_p50_views=excluded.video_p50_views,
           video_p75_views=excluded.video_p75_views,
           video_p100_views=excluded.video_p100_views,
           action_values=excluded.action_values,raw_metric=excluded.raw_metric,
           last_synced_at=now(),updated_at=now()`,
        [run.organization_id,run.project_id,localAccountId,ids.campaign_id,
         ids.ad_set_id,ids.ad_id,String(insight.ad_id),String(insight.date_start),
         effectiveCurrency,String(insight.spend??"0"),
         String(insight.impressions??"0"),String(insight.reach??"0"),
         String(insight.clicks??"0"),JSON.stringify(insight.actions??null),
         JSON.stringify(insight.action_values??null),JSON.stringify(insight),
         video.views3s,video.thruplay,video.p25,video.p50,video.p75,video.p100],
      );
      counts.insights+=1;
    }
  }
  return counts;
}

export async function processMetaSync(pool:pg.Pool,maxAttempts:number){
  const run=await claim(pool);
  if(!run)return {claimed:0,completed:0,failed:0};
  try{
    const counts=await synchronize(pool,run);
    await pool.query(
      `update public.meta_sync_runs set status='completed',finished_at=now(),
              account_count=$2,campaign_count=$3,ad_set_count=$4,ad_count=$5,
              creative_count=$6,insight_count=$7,updated_at=now() where id=$1`,
      [run.id,counts.accounts,counts.campaigns,counts.adSets,counts.ads,
       counts.creatives,counts.insights],
    );
    await pool.query(
      `insert into public.audit_logs(organization_id,project_id,action,
         target_type,target_id,after)
       values($1,$2,'meta_catalog_synchronized','connection',$3,$4::jsonb)`,
      [run.organization_id,run.project_id,run.connection_id,JSON.stringify({
        accountCount:counts.accounts,campaignCount:counts.campaigns,
        adSetCount:counts.adSets,adCount:counts.ads,creativeCount:counts.creatives,
        insightCount:counts.insights,graphVersion,insightWindowDays:run.sync_scope==="insights"?3:30,syncScope:run.sync_scope,
        executionMode:"automatic",
      })],
    );
    return {claimed:1,completed:1,failed:0};
  }catch(error){
    const canRetry=run.sync_scope!=="insights"&&retryable(error)&&run.attempts<maxAttempts;
    const retryDelaySeconds=Math.min(3600,60*(2**Math.max(0,run.attempts-1)));
    let finalErrorCode=errorCode(error);
    if(finalErrorCode==="meta_http_401"){
      const marked=await markMetaAuthorizationExpired(pool,run.connection_id).catch(()=>false);
      if(marked)finalErrorCode="meta_token_expired";
    }
    await pool.query(
      `update public.meta_sync_runs set status=$2,error_code=$3,
              finished_at=case when $2='failed_terminal' then now() else null end,
              next_attempt_at=case when $2='failed_retryable'
                then now()+($4::text||' seconds')::interval else next_attempt_at end,
              updated_at=now() where id=$1`,
      [run.id,canRetry?"failed_retryable":"failed_terminal",finalErrorCode,
       retryDelaySeconds],
    );
    return {
      claimed:1,
      completed:0,
      failed:1,
      error:error instanceof Error?error.message.slice(0,240):"meta_sync_failed",
    };
  }
}
