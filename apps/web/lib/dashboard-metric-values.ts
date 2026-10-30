import type {Database} from "@funil-metrics/database";

export type DashboardMetricValues=Record<string,{value:number;currency?:string;available:boolean;
  partial?:boolean;coverage?:number;blockedRows?:number;status?:string}>;
export type DashboardMetricPoint={date:string;value:number};
export type DashboardMetricSeries=Record<string,DashboardMetricPoint[]>;
export type DashboardQueryFilters={productId?:string|null;productIds?:string[]|null;accountId?:string|null;campaignId?:string|null;
 from?:string|null;to?:string|null;timezone?:string|null;
 offerId?:string|null;source?:string|null;medium?:string|null;paymentMethod?:string|null;paymentStatus?:string|null;buyerSegment?:"new"|"recurring"|null;
 revenueBasis?:"producer_commission"|"sale_total"|null};

function commerceFilterSql(buyerSegment:DashboardQueryFilters["buyerSegment"]){return `
 and ($8::uuid is null or exists(select 1 from public.commerce_orders filtered_order where filtered_order.id=event.order_id and filtered_order.offer_id=$8))
 and ($9::text is null or coalesce((select coalesce(nullif(a.utm_source,''),nullif(a.src,'')) from public.order_attributions a where a.order_id=event.order_id order by a.created_at desc limit 1),'N\u00e3o informado')=$9)
 and ($10::text is null or coalesce((select nullif(a.utm_medium,'') from public.order_attributions a where a.order_id=event.order_id order by a.created_at desc limit 1),'N\u00e3o informada')=$10)
 and ($11::text is null or exists(select 1 from public.payments filtered_payment where filtered_payment.order_id=event.order_id and filtered_payment.method=$11))
 and ($12::text is null or exists(select 1 from public.payments filtered_payment where filtered_payment.order_id=event.order_id and filtered_payment.status::text=$12))
 and ($13::text is null or exists(select 1 from public.commerce_orders buyer_order where buyer_order.id=event.order_id and buyer_order.person_id is not null and (select count(distinct history_event.payment_id) from public.commerce_orders history_order join public.normalized_payment_events history_event on history_event.order_id=history_order.id and history_event.data_scope='production' and history_event.sale_financial_effect>0 where history_order.project_id=event.project_id and history_order.person_id=buyer_order.person_id) ${buyerSegment==="recurring"?">=2":"=1"}))`}

export async function loadDashboardMetricValues(database:Database,projectId:string,periodDays:number,
 filters:DashboardQueryFilters={}){
 const revenueBasis=filters.revenueBasis==="sale_total"?"sale_total":"producer_commission";
 const commerceScoped=Boolean(filters.productId||filters.productIds?.length||filters.offerId||filters.source||filters.medium||filters.paymentMethod||filters.paymentStatus||filters.buyerSegment);
 const effectColumn=revenueBasis==="sale_total"?"sale_financial_effect":"producer_commission_financial_effect";
 const financial=(await database.pool.query<{gross_revenue:string;net_revenue:string;
  approved_payments:number;pending_payments:number;reversed_payments:number;eligible_events:number;covered_events:number}>(`select
   coalesce(sum(${effectColumn}) filter(where ${effectColumn}>0),0)::text gross_revenue,
   coalesce(sum(${effectColumn}),0)::text net_revenue,
   count(distinct payment_id) filter(where sale_financial_effect>0)::int approved_payments,
   count(distinct payment_id) filter(where event.type='payment_pending')::int pending_payments,
   count(distinct payment_id) filter(where sale_financial_effect<0)::int reversed_payments,
   count(*) filter(where sale_financial_effect<>0)::int eligible_events,
   count(*) filter(where sale_financial_effect<>0 and ($7='sale_total' or commission_data_status='complete'))::int covered_events
   from public.normalized_payment_events event where event.project_id=$1 and event.data_scope='production'
   and (event.occurred_at at time zone $6)>=coalesce($4::date,(now() at time zone $6)-($2::integer*interval '1 day'))
   and (event.occurred_at at time zone $6)<coalesce($5::date+interval '1 day',(now() at time zone $6)+interval '1 day') and ($3::uuid[] is null or exists(
    select 1 from public.commerce_order_items item where item.order_id=event.order_id and item.product_id=any($3)
   ))${commerceFilterSql(filters.buyerSegment)}`,[projectId,periodDays,filters.productIds?.length?filters.productIds:(filters.productId?[filters.productId]:null),filters.from??null,filters.to??null,
    filters.timezone??"UTC",revenueBasis,filters.offerId??null,filters.source??null,filters.medium??null,filters.paymentMethod??null,filters.paymentStatus??null,filters.buyerSegment??null])).rows[0];
 const meta=(await database.pool.query<{spend:string;impressions:string;clicks:string;currency:string|null;
  rows:number;converted_rows:number;blocked_rows:number}>(
  `select coalesce(sum(spend_base) filter(where conversion_status in ('converted','not_required')),0)::text spend,
   coalesce(sum(impressions),0)::text impressions,coalesce(sum(clicks),0)::text clicks,
   min(base_currency) filter(where conversion_status in ('converted','not_required')) currency,count(*)::int rows,
   count(*) filter(where conversion_status in ('converted','not_required'))::int converted_rows,
   count(*) filter(where conversion_status not in ('converted','not_required'))::int blocked_rows
   from public.meta_ad_insights_daily where project_id=$1
   and metric_date>=coalesce($5::date,(current_date-(($2::integer-1)*interval '1 day'))::date)
   and metric_date<=coalesce($6::date,current_date)
   and ($3::uuid is null or meta_ad_account_id=$3)
   and ($4::uuid is null or meta_campaign_id=$4)`,[projectId,periodDays,
    filters.accountId??null,filters.campaignId??null,filters.from??null,filters.to??null])).rows[0];
 const metaActions=await database.pool.query<{link_clicks:string;landing_page_views:string;view_content:string;add_to_cart:string;initiate_checkout:string;action_rows:number}>(
  `select
   coalesce(sum(case when item.value->>'action_type'='link_click' then (item.value->>'value')::numeric else 0 end),0)::text link_clicks,
   coalesce(sum(case when item.value->>'action_type'='landing_page_view' then (item.value->>'value')::numeric else 0 end),0)::text landing_page_views,
   coalesce(sum(case when item.value->>'action_type'='view_content' then (item.value->>'value')::numeric else 0 end),0)::text view_content,
   coalesce(sum(case when item.value->>'action_type'='add_to_cart' then (item.value->>'value')::numeric else 0 end),0)::text add_to_cart,
   coalesce(sum(case when item.value->>'action_type'='initiate_checkout' then (item.value->>'value')::numeric else 0 end),0)::text initiate_checkout,
   count(item.value)::int action_rows
   from public.meta_ad_insights_daily insight
   left join lateral jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) item(value) on true
   where insight.project_id=$1
   and insight.metric_date>=coalesce($5::date,(current_date-(($2::integer-1)*interval '1 day'))::date)
   and insight.metric_date<=coalesce($6::date,current_date)
   and ($3::uuid is null or insight.meta_ad_account_id=$3)
   and ($4::uuid is null or insight.meta_campaign_id=$4)`,[projectId,periodDays,
    filters.accountId??null,filters.campaignId??null,filters.from??null,filters.to??null])
  .then(result=>result.rows[0])
  .catch(()=>null);
 const eligible=Number(financial?.eligible_events??0),covered=Number(financial?.covered_events??0);
 const revenuePartial=eligible>covered;
 return {
  gross_revenue:{value:Number(financial?.gross_revenue??0),available:covered>0||eligible===0,
   partial:revenuePartial,coverage:eligible>0?covered/eligible:1,
   blockedRows:Math.max(eligible-covered,0),status:revenuePartial?"partial":"complete"},
  net_revenue:{value:Number(financial?.net_revenue??0),available:covered>0||eligible===0,
   partial:revenuePartial,coverage:eligible>0?covered/eligible:1,
   blockedRows:Math.max(eligible-covered,0),status:revenuePartial?"partial":"complete"},
  approved_payments:{value:Number(financial?.approved_payments??0),available:true},
  pending_payments:{value:Number(financial?.pending_payments??0),available:true},
  reversed_payments:{value:Number(financial?.reversed_payments??0),available:true},
  meta_spend:{value:Number(meta?.spend??0),currency:meta?.currency??undefined,
   available:!commerceScoped&&Number(meta?.converted_rows??0)>0,
   partial:Boolean(meta?.rows)&&Number(meta?.blocked_rows??0)>0,
   coverage:Number(meta?.rows??0)>0?Number(meta?.converted_rows??0)/Number(meta?.rows):0,
   blockedRows:Number(meta?.blocked_rows??0),status:Number(meta?.blocked_rows??0)>0?"partial":"complete"},
  meta_impressions:{value:Number(meta?.impressions??0),available:!commerceScoped&&Boolean(meta?.rows)},
  meta_clicks:{value:Number(meta?.clicks??0),available:!commerceScoped&&Boolean(meta?.rows)},
  meta_link_clicks:{value:Number(metaActions?.link_clicks??0),available:!commerceScoped&&Number(metaActions?.action_rows??0)>0},
  meta_landing_page_views:{value:Number(metaActions?.landing_page_views??0),available:!commerceScoped&&Number(metaActions?.action_rows??0)>0},
  meta_view_content:{value:Number(metaActions?.view_content??0),available:!commerceScoped&&Number(metaActions?.action_rows??0)>0},
  meta_add_to_cart:{value:Number(metaActions?.add_to_cart??0),available:!commerceScoped&&Number(metaActions?.action_rows??0)>0},
  meta_initiate_checkout:{value:Number(metaActions?.initiate_checkout??0),available:!commerceScoped&&Number(metaActions?.action_rows??0)>0},
 } satisfies DashboardMetricValues;
}

export async function loadDashboardMetricSeries(database:Database,projectId:string,periodDays:number,
 filters:DashboardQueryFilters={}){
 const revenueBasis=filters.revenueBasis==="sale_total"?"sale_total":"producer_commission";
 const commerceScoped=Boolean(filters.productId||filters.productIds?.length||filters.offerId||filters.source||filters.medium||filters.paymentMethod||filters.paymentStatus||filters.buyerSegment);
 const effectColumn=revenueBasis==="sale_total"?"sale_financial_effect":"producer_commission_financial_effect";
 const financial=(await database.pool.query<{metric_day:string;gross_revenue:string;net_revenue:string;
  approved_payments:number;reversed_payments:number}>(`select
   to_char(date_trunc('day',occurred_at at time zone $6),'YYYY-MM-DD') as metric_day,
   coalesce(sum(${effectColumn}) filter(where ${effectColumn}>0),0)::text gross_revenue,
   coalesce(sum(${effectColumn}),0)::text net_revenue,
   count(distinct payment_id) filter(where sale_financial_effect>0)::int approved_payments,
   count(distinct payment_id) filter(where sale_financial_effect<0)::int reversed_payments
   from public.normalized_payment_events event where event.project_id=$1 and event.data_scope='production'
   and (event.occurred_at at time zone $6)>=coalesce($4::date,(now() at time zone $6)-($2::integer*interval '1 day'))
   and (event.occurred_at at time zone $6)<coalesce($5::date+interval '1 day',(now() at time zone $6)+interval '1 day') and ($3::uuid[] is null or exists(
    select 1 from public.commerce_order_items item where item.order_id=event.order_id and item.product_id=any($3)
   ))${commerceFilterSql(filters.buyerSegment)} group by date_trunc('day',event.occurred_at at time zone $6)
   order by date_trunc('day',event.occurred_at at time zone $6)`,[projectId,periodDays,filters.productIds?.length?filters.productIds:(filters.productId?[filters.productId]:null),
    filters.from??null,filters.to??null,filters.timezone??"UTC",revenueBasis,filters.offerId??null,filters.source??null,filters.medium??null,filters.paymentMethod??null,filters.paymentStatus??null,filters.buyerSegment??null])).rows;
 const meta=(await database.pool.query<{metric_day:string;spend:string;impressions:string;clicks:string}>(
  `select metric_date::text as metric_day,coalesce(sum(spend_base),0)::text spend,
   coalesce(sum(impressions),0)::text impressions,coalesce(sum(clicks),0)::text clicks
   from public.meta_ad_insights_daily where project_id=$1
   and metric_date>=coalesce($5::date,(current_date-(($2::integer-1)*interval '1 day'))::date)
   and metric_date<=coalesce($6::date,current_date)
   and conversion_status in ('converted','not_required')
   and ($3::uuid is null or meta_ad_account_id=$3) and ($4::uuid is null or meta_campaign_id=$4)
   group by metric_date order by metric_date`,[projectId,periodDays,filters.accountId??null,
    filters.campaignId??null,filters.from??null,filters.to??null])).rows;
 return {
  gross_revenue:financial.map(row=>({date:row.metric_day,value:Number(row.gross_revenue)})),
  net_revenue:financial.map(row=>({date:row.metric_day,value:Number(row.net_revenue)})),
  approved_payments:financial.map(row=>({date:row.metric_day,value:Number(row.approved_payments)})),
  reversed_payments:financial.map(row=>({date:row.metric_day,value:Number(row.reversed_payments)})),
  meta_spend:commerceScoped?[]:meta.map(row=>({date:row.metric_day,value:Number(row.spend)})),
  meta_impressions:commerceScoped?[]:meta.map(row=>({date:row.metric_day,value:Number(row.impressions)})),
  meta_clicks:commerceScoped?[]:meta.map(row=>({date:row.metric_day,value:Number(row.clicks)})),
 } satisfies DashboardMetricSeries;
}
