import {redirect} from "next/navigation";
import {after} from "next/server";
import {getActiveProject} from "../../lib/active-project";
import {getDatabase} from "../../lib/database";
import {loadDashboardMetricSeries,loadDashboardMetricValues} from "../../lib/dashboard-metric-values";
import {createClient} from "../../lib/supabase/server";
import {DashboardV2Client} from "./dashboard-v2-client";
import {DashboardSidebar} from "../dashboard/dashboard-sidebar";
import {calendarDateInTimeZone,shiftCalendarDate} from "../../lib/calendar-date";
import {dddToUf,extractAdId} from "../../lib/dashboard-inteligente";
import {groupMethodApproval,groupMethodSales} from "../../lib/payment-methods";
import {queueMetaSyncIfStale} from "../../lib/meta-sync-queue";
import {UF_NAMES} from "../dashboard/dashboard-inteligente/brazil-map-data";

type Search={from?:string;to?:string;account?:string;product?:string|string[];channel?:string;medium?:string;offer?:string;payment_method?:string;payment_status?:string;buyer?:string;compare?:string;basis?:string};
type Option={id:string;name:string};
type Ranked={name:string;value:number;amount?:number};
type SavedWidget={instanceId:string;kind:string;title:string;config:Record<string,unknown>;grid_x:number;grid_y:number;grid_width:number;grid_height:number;display_order:number};
type SavedTemplate={id:string;name:string;definition:{version?:number;source?:string;widgets?:Array<{id:string;kind:string;gridWidth:number;gridHeight:number;gridX:number;gridY:number;config?:Record<string,unknown>}>};createdAt:string};

function validDate(value?:string){return value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null}
function productIds(value?:string|string[]){
 const values=(Array.isArray(value)?value:[value??""]).flatMap(item=>item.split(","));
 return [...new Set(values.filter(item=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)))];
}

export default async function DashboardV2Page({searchParams}:{searchParams:Promise<Search>}){
 const query=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");
 const context=await getActiveProject(data.user.id);if(!context.project)redirect("/dashboard/projetos");
 const project=context.project,database=getDatabase();
 after(async()=>{await queueMetaSyncIfStale(database.pool,{organizationId:project.organization_id,projectId:project.id,authUserId:data.user.id}).catch(()=>0)});
 const today=calendarDateInTimeZone(new Date(),project.timezone);
 const to=validDate(query.to)??today;
 const from=validDate(query.from)??shiftCalendarDate(today,-29);
 const periodDays=Math.max(1,Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1);
 const previousTo=shiftCalendarDate(from,-1),previousFrom=shiftCalendarDate(from,-periodDays);
 const revenueBasis=query.basis==="sale_total"?"sale_total" as const:"producer_commission" as const,selectedProducts=productIds(query.product),selectedAccounts=productIds(query.account);
 const buyerSegment:"new"|"recurring"|null=query.buyer==="new"||query.buyer==="recurring"?query.buyer:null;
 const filters={from,to,accountIds:selectedAccounts.length?selectedAccounts:null,productIds:selectedProducts.length?selectedProducts:null,timezone:project.timezone,revenueBasis,
  source:query.channel??null,medium:query.medium??null,offerId:query.offer??null,paymentMethod:query.payment_method??null,paymentStatus:query.payment_status??null,buyerSegment};
 const effectColumn=revenueBasis==="sale_total"?"sale_financial_effect":"producer_commission_financial_effect";
 const emptyValues={gross_revenue:{value:0,available:false},net_revenue:{value:0,available:false},
  approved_payments:{value:0,available:false},pending_payments:{value:0,available:false},reversed_payments:{value:0,available:false},
  meta_spend:{value:0,available:false},meta_impressions:{value:0,available:false},meta_clicks:{value:0,available:false},meta_link_clicks:{value:0,available:false},
  meta_landing_page_views:{value:0,available:false},meta_view_content:{value:0,available:false},
  meta_add_to_cart:{value:0,available:false},meta_initiate_checkout:{value:0,available:false}};
 const emptySeries={gross_revenue:[],net_revenue:[],approved_payments:[],reversed_payments:[],meta_spend:[],meta_impressions:[],meta_clicks:[]};
 const previousFilters={...filters,from:previousFrom,to:previousTo};
 const [metrics,previousMetrics,series,accounts,products,offers,media,paymentMethods,paymentStatuses,productSales,accountSpend,channels,hours,savedWidgets,savedTemplates,adSalesUtm,adSpendRows,adNames,phoneSalesRows,recentSaleRows,productApprovedRows,methodSaleRows,methodAttemptRows]=await Promise.all([
  loadDashboardMetricValues(database,project.id,30,filters).catch(()=>emptyValues),
  loadDashboardMetricValues(database,project.id,30,previousFilters).catch(()=>emptyValues),
  loadDashboardMetricSeries(database,project.id,30,filters).catch(()=>emptySeries),
  database.pool.query<Option>(`select id,name from public.meta_ad_accounts where project_id=$1 order by name`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<Option>(`select id,name from public.commerce_products where project_id=$1 and data_scope='production' order by name`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<Option>(`select distinct offer.id,offer.name from public.commerce_offers offer join public.commerce_orders orders on orders.offer_id=offer.id where orders.project_id=$1 and orders.data_scope='production' order by offer.name`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string}>(`select distinct coalesce(nullif(attribution.utm_medium,''),'Não informada') name from public.order_attributions attribution join public.commerce_orders orders on orders.id=attribution.order_id where orders.project_id=$1 and orders.data_scope='production' order by 1`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string}>(`select distinct payment.method name from public.payments payment join public.commerce_orders orders on orders.id=payment.order_id where orders.project_id=$1 and orders.data_scope='production' and payment.method is not null order by 1`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string}>(`select distinct payment.status name from public.payments payment join public.commerce_orders orders on orders.id=payment.order_id where orders.project_id=$1 and orders.data_scope='production' and payment.status is not null order by 1`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string;value:number}>(`select product.name,count(distinct item.order_id)::int value from public.commerce_order_items item join public.commerce_products product on product.id=item.product_id join public.commerce_orders orders on orders.id=item.order_id where orders.project_id=$1 and orders.data_scope='production' and (orders.occurred_at at time zone $5)>=$2::date and (orders.occurred_at at time zone $5)<$3::date+interval '1 day' and ($4::uuid[] is null or product.id=any($4)) group by product.name order by value desc limit 6`,[project.id,from,to,selectedProducts.length?selectedProducts:null,project.timezone]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string;value:number;amount:string}>(`select account.name,coalesce(sum(insight.spend_base),0)::float value,coalesce(sum(insight.spend_base),0)::text amount from public.meta_ad_insights_daily insight join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id where insight.project_id=$1 and insight.metric_date between $2::date and $3::date and insight.conversion_status in ('converted','not_required') and ($4::uuid[] is null or account.id=any($4)) group by account.name order by value desc limit 6`,[project.id,from,to,selectedAccounts.length?selectedAccounts:null]).then(r=>r.rows.map(x=>({...x,amount:Number(x.amount)}))).catch(()=>[]),
  database.pool.query<{name:string;value:number}>(`select coalesce(nullif(attribution.utm_source,''),nullif(attribution.src,''),'N\u00e3o informado') name,count(distinct attribution.order_id)::int value from public.order_attributions attribution join public.commerce_orders orders on orders.id=attribution.order_id where orders.project_id=$1 and orders.data_scope='production' and (orders.occurred_at at time zone $4)>=$2::date and (orders.occurred_at at time zone $4)<$3::date+interval '1 day' group by 1 order by value desc limit 6`,[project.id,from,to,project.timezone]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string;value:number}>(`select to_char(event.occurred_at at time zone $4,'HH24') name,count(distinct event.payment_id)::int value from public.normalized_payment_events event where event.project_id=$1 and event.data_scope='production' and event.financial_effect>0 and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day' group by 1 order by 1`,[project.id,from,to,project.timezone]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<SavedWidget>(`select coalesce(widget.config->>'v2InstanceId',widget.config->>'v2Kind') "instanceId",widget.config->>'v2Kind' kind,widget.title,widget.config,widget.grid_x,widget.grid_y,widget.grid_width,widget.grid_height,widget.display_order from public.dashboards dashboard join public.dashboard_versions version on version.dashboard_id=dashboard.id and version.status='draft' join public.dashboard_widgets widget on widget.dashboard_version_id=version.id where dashboard.project_id=$1 and dashboard.status='active' and dashboard.description='[funil-metrics:dashboard-v2]' and widget.config ? 'v2Kind' order by widget.display_order`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<SavedTemplate>(`select id,name,definition,created_at::text "createdAt" from public.dashboard_templates where project_id=$1 and not is_system order by created_at desc`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{utm_content:string|null;sales:number;revenue:string}>(`
   with first_attr as (
     select distinct on (attr.order_id) attr.order_id, attr.utm_content
       from public.order_attributions attr
      where attr.project_id=$1
      order by attr.order_id, attr.created_at asc)
   select first_attr.utm_content,
     count(distinct event.payment_id)::int sales,
     coalesce(sum(event.${effectColumn}) filter(where event.sale_financial_effect>0),0)::text revenue
     from public.normalized_payment_events event
     left join first_attr on first_attr.order_id=event.order_id
    where event.project_id=$1 and event.data_scope='production'
     and event.sale_financial_effect>0
     and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day'
     and ($5::uuid[] is null or exists(select 1 from public.commerce_order_items item where item.order_id=event.order_id and item.product_id=any($5)))
    group by first_attr.utm_content`,[project.id,from,to,project.timezone,selectedProducts.length?selectedProducts:null]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{external_ad_id:string;spend:string;impressions:string;link_clicks:string}>(`
   select insight.external_ad_id,
     coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
     coalesce(sum(insight.impressions),0)::text impressions,
     coalesce(sum(coalesce((select sum((elem->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) elem where elem->>'action_type'='link_click'),0)),0)::text link_clicks
     from public.meta_ad_insights_daily insight
    where insight.project_id=$1 and insight.metric_date between $2::date and $3::date
     and ($4::uuid[] is null or insight.meta_ad_account_id=any($4))
    group by insight.external_ad_id`,[project.id,from,to,selectedAccounts.length?selectedAccounts:null]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{external_id:string;name:string;campaign_name:string|null}>(`select ad.external_id,ad.name,campaign.name campaign_name from public.meta_ads ad left join public.meta_campaigns campaign on campaign.id=ad.meta_campaign_id where ad.project_id=$1`,[project.id]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{phone:string|null;sales:number;revenue:string}>(`
   select phone.normalized_value phone,
     count(distinct event.payment_id)::int sales,
     coalesce(sum(event.${effectColumn}) filter(where event.sale_financial_effect>0),0)::text revenue
     from public.normalized_payment_events event
     join public.commerce_orders ord on ord.id=event.order_id
     left join lateral (select ident.normalized_value from public.person_identifiers ident where ident.person_id=ord.person_id and ident.project_id=ord.project_id and ident.type='phone' order by ident.created_at asc limit 1) phone on true
    where event.project_id=$1 and event.data_scope='production' and event.sale_financial_effect>0
     and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day'
     and ($5::uuid[] is null or exists(select 1 from public.commerce_order_items item where item.order_id=event.order_id and item.product_id=any($5)))
    group by phone.normalized_value`,[project.id,from,to,project.timezone,selectedProducts.length?selectedProducts:null]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{occurred_at:string;amount:string;product_name:string|null;phone:string|null}>(`
   select event.occurred_at::text occurred_at, event.${effectColumn}::text amount,
     (select product.name from public.commerce_order_items item join public.commerce_products product on product.id=item.product_id where item.order_id=ord.id order by product.name limit 1) product_name,
     phone.normalized_value phone
     from public.normalized_payment_events event
     join public.commerce_orders ord on ord.id=event.order_id
     left join lateral (select ident.normalized_value from public.person_identifiers ident where ident.person_id=ord.person_id and ident.project_id=ord.project_id and ident.type='phone' order by ident.created_at asc limit 1) phone on true
    where event.project_id=$1 and event.data_scope='production' and event.sale_financial_effect>0
     and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day'
    order by event.occurred_at desc limit 12`,[project.id,from,to,project.timezone]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{name:string;sales:number;revenue:string}>(`
   select product.name,count(distinct event.payment_id)::int sales,
     coalesce(sum(event.${effectColumn}) filter(where event.sale_financial_effect>0),0)::text revenue
     from public.normalized_payment_events event
     join public.commerce_order_items item on item.order_id=event.order_id
     join public.commerce_products product on product.id=item.product_id
    where event.project_id=$1 and event.data_scope='production' and event.sale_financial_effect>0
     and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day'
     and ($5::uuid[] is null or product.id=any($5))
    group by product.name order by sales desc`,[project.id,from,to,project.timezone,selectedProducts.length?selectedProducts:null]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{method:string|null;sales:number;revenue:string}>(`
   select payment.method,count(distinct event.payment_id)::int sales,
     coalesce(sum(event.${effectColumn}) filter(where event.sale_financial_effect>0),0)::text revenue
     from public.normalized_payment_events event
     join public.payments payment on payment.id=event.payment_id
    where event.project_id=$1 and event.data_scope='production' and event.sale_financial_effect>0
     and (event.occurred_at at time zone $4)>=$2::date and (event.occurred_at at time zone $4)<$3::date+interval '1 day'
     and ($5::uuid[] is null or exists(select 1 from public.commerce_order_items item where item.order_id=event.order_id and item.product_id=any($5)))
    group by payment.method order by sales desc`,[project.id,from,to,project.timezone,selectedProducts.length?selectedProducts:null]).then(r=>r.rows).catch(()=>[]),
  database.pool.query<{method:string|null;approved:number;concluded:number}>(`
   select payment.method,
     count(*) filter(where payment.status='approved')::int approved,
     count(*) filter(where payment.status in ('approved','failed','expired','cancelled'))::int concluded
     from public.payments payment
     join public.commerce_orders ord on ord.id=payment.order_id
    where ord.project_id=$1 and ord.data_scope='production'
     and (ord.occurred_at at time zone $4)>=$2::date and (ord.occurred_at at time zone $4)<$3::date+interval '1 day'
     and ($5::uuid[] is null or exists(select 1 from public.commerce_order_items item where item.order_id=ord.id and item.product_id=any($5)))
    group by payment.method`,[project.id,from,to,project.timezone,selectedProducts.length?selectedProducts:null]).then(r=>r.rows).catch(()=>[]),
 ]);
 const salesByAd=new Map<string,{sales:number;revenue:number}>();const organic={sales:0,revenue:0};
 for(const row of adSalesUtm){const adId=extractAdId(row.utm_content);if(!adId){organic.sales+=row.sales;organic.revenue+=Number(row.revenue);continue}const current=salesByAd.get(adId)??{sales:0,revenue:0};current.sales+=row.sales;current.revenue+=Number(row.revenue);salesByAd.set(adId,current)}
 const spendByAd=new Map(adSpendRows.map(row=>[row.external_ad_id,row]));
 const nameByAd=new Map(adNames.map(row=>[row.external_id,row]));
 const adPerformance=[...new Set([...salesByAd.keys(),...spendByAd.keys()])].map(adId=>{const sale=salesByAd.get(adId)??{sales:0,revenue:0};const spendRow=spendByAd.get(adId);return{adId,name:nameByAd.get(adId)?.name??`Anúncio ${adId}`,campaign:nameByAd.get(adId)?.campaign_name??"—",sales:sale.sales,revenue:sale.revenue,spend:spendRow?Number(spendRow.spend):0,impressions:spendRow?Number(spendRow.impressions):0,linkClicks:spendRow?Number(spendRow.link_clicks):0}}).sort((a,b)=>b.revenue-a.revenue||b.spend-a.spend).slice(0,50);
 const regionMap=new Map<string,{sales:number;revenue:number}>();let salesWithoutPhone=0;
 for(const row of phoneSalesRows){const uf=dddToUf(row.phone);if(!uf){salesWithoutPhone+=row.sales;continue}const current=regionMap.get(uf)??{sales:0,revenue:0};current.sales+=row.sales;current.revenue+=Number(row.revenue);regionMap.set(uf,current)}
 const regions=[...regionMap.entries()].map(([uf,value])=>({uf,name:UF_NAMES[uf]??uf,sales:value.sales,revenue:value.revenue})).sort((a,b)=>b.sales-a.sales);
 const regionData=Object.fromEntries(regions.map(row=>[row.uf,{sales:row.sales,revenue:row.revenue}]));
 const recentSales=recentSaleRows.map(row=>({occurredAt:row.occurred_at,amount:Number(row.amount),product:row.product_name??"Produto",uf:dddToUf(row.phone)}));
 const productDonut=productApprovedRows.map(row=>({name:row.name,sales:row.sales,revenue:Number(row.revenue)}));
 const methodSales=groupMethodSales(methodSaleRows.map(row=>({method:row.method,sales:row.sales,revenue:Number(row.revenue)})));
 const methodApproval=groupMethodApproval(methodAttemptRows);
 const intelligent={adPerformance,organic,regions,regionData,salesWithoutPhone,recentSales,productDonut,methodSales,methodApproval};
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard-v2" footerLabel="Dados conectados"/>
  <section className="app-content"><DashboardV2Client project={{id:project.id,name:project.name,currency:project.currency,timezone:project.timezone}}
   filters={{from,to,account:selectedAccounts.join(","),product:selectedProducts.join(","),channel:query.channel??"",medium:query.medium??"",offer:query.offer??"",payment_method:query.payment_method??"",payment_status:query.payment_status??"",buyer:buyerSegment??"",compare:query.compare??"previous",basis:revenueBasis}}
   accounts={accounts} products={products} metrics={metrics} previousMetrics={previousMetrics} series={series}
   advancedOptions={{offers,media,paymentMethods,paymentStatuses}}
   savedWidgets={savedWidgets} savedTemplates={savedTemplates}
   rankings={{productSales:productSales as Ranked[],accountSpend:accountSpend as Ranked[],channels:channels as Ranked[],hours:hours as Ranked[]}} intelligent={intelligent}/>
  </section></main>;
}
