import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {DateRangePicker} from "../campanhas/date-range-picker";
import {calendarDateInTimeZone,shiftCalendarDate} from "../../../lib/calendar-date";
import {ManagerTable} from "./manager-table";
import {saveManagerFilters} from "./actions";

export const dynamic="force-dynamic";
type Level="accounts"|"campaigns"|"adsets"|"ads";
type Params={level?:string;q?:string;account?:string;status?:string;campaign?:string;adset?:string;from?:string;to?:string;notice?:string;page?:string};
type Row={id:string;name:string;status:string|null;parent_name:string|null;account_name:string;
 currency:string|null;budget:string|null;spend:string;impressions:string;reach:string;clicks:string;
 landing_page_views:string;initiate_checkout:string;campaign_id:string|null};
type Option={value:string;label:string};
const levels:Record<Level,string>={accounts:"Contas",campaigns:"Campanhas",adsets:"Conjuntos",ads:"Anúncios"};
const iso=(value:string|undefined)=>/^\d{4}-\d{2}-\d{2}$/.test(value??"")?value!:null;
const PAGE_SIZE=50;

export default async function Page({searchParams}:{searchParams:Promise<Params>}){
 const params=await searchParams,level=(Object.hasOwn(levels,params.level??"")?params.level:"campaigns") as Level;
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const db=getDatabase();
 const actor=(await db.pool.query<{id:string}>("select id from public.users where auth_user_id=$1",[data.user.id])).rows[0];
 const preference=actor?(await db.pool.query<{columns:string[];filters:Record<string,string>}>(`select columns,filters from public.meta_manager_views
  where project_id=$1 and user_id=$2 and level=$3`,[project.id,actor.id,level])).rows[0]:null;
 const saved=preference?.filters??{};
 const q=(params.q??saved.q??"").trim().slice(0,100);
 const account=/^[0-9a-f-]{36}$/i.test(params.account??saved.account??"")?(params.account??saved.account)!:"";
 const campaign=/^[0-9a-f-]{36}$/i.test(params.campaign??"")?params.campaign!:"";
 const adset=/^[0-9a-f-]{36}$/i.test(params.adset??"")?params.adset!:"";
 const status=(params.status??saved.status??"").trim().slice(0,50);
 const today=calendarDateInTimeZone(new Date(),project.timezone);
 const from=iso(params.from)??iso(saved.from)??shiftCalendarDate(today,-29),to=iso(params.to)??iso(saved.to)??today;
 const requestedPage=Math.max(1,Number.parseInt(params.page??"1",10)||1);
 let sql="";
 if(level==="accounts")sql=`select account.id,account.name,account.account_status::text status,null::text parent_name,
  account.name account_name,$7::text currency,null::text budget,coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
  coalesce(sum(insight.impressions),0)::text impressions,coalesce(sum(insight.reach),0)::text reach,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='link_click'),0)),0)::text clicks,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='landing_page_view'),0)),0)::text landing_page_views,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='initiate_checkout'),0)),0)::text initiate_checkout,
  null::uuid campaign_id from public.meta_ad_accounts account left join public.meta_ad_insights_daily insight
  on insight.meta_ad_account_id=account.id and insight.metric_date between $2::date and $3::date
  where account.project_id=$1 and ($4='' or account.id::text=$4) and ($5='' or account.account_status::text=$5)
  and ($6='' or account.name ilike '%'||$6||'%') and ($8='' or true) and ($9='' or true) group by account.id order by sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')) desc nulls last,account.name`;
 if(level==="campaigns")sql=`select campaign.id,campaign.name,coalesce(campaign.effective_status,campaign.status) status,
  null::text parent_name,account.name account_name,$7::text currency,
  coalesce(campaign.daily_budget_minor,campaign.lifetime_budget_minor)::text budget,
  coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,coalesce(sum(insight.impressions),0)::text impressions,coalesce(sum(insight.reach),0)::text reach,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='link_click'),0)),0)::text clicks,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='landing_page_view'),0)),0)::text landing_page_views,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='initiate_checkout'),0)),0)::text initiate_checkout,campaign.id campaign_id from public.meta_campaigns campaign
  join public.meta_ad_accounts account on account.id=campaign.meta_ad_account_id
  left join public.meta_ads ad on ad.meta_campaign_id=campaign.id left join public.meta_ad_insights_daily insight
  on insight.meta_ad_id=ad.id and insight.metric_date between $2::date and $3::date
  where campaign.project_id=$1 and ($4='' or account.id::text=$4)
  and ($5='' or coalesce(campaign.effective_status,campaign.status,'')=$5)
  and ($6='' or campaign.name ilike '%'||$6||'%') and ($8='' or campaign.id::text=$8) and ($9='' or true) group by campaign.id,account.id
  order by sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')) desc nulls last,campaign.name`;
 if(level==="adsets")sql=`select adset.id,adset.name,coalesce(adset.effective_status,adset.status) status,
  campaign.name parent_name,account.name account_name,$7::text currency,
  coalesce(adset.daily_budget_minor,adset.lifetime_budget_minor)::text budget,
  coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,coalesce(sum(insight.impressions),0)::text impressions,coalesce(sum(insight.reach),0)::text reach,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='link_click'),0)),0)::text clicks,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='landing_page_view'),0)),0)::text landing_page_views,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='initiate_checkout'),0)),0)::text initiate_checkout,campaign.id campaign_id from public.meta_ad_sets adset
  join public.meta_campaigns campaign on campaign.id=adset.meta_campaign_id
  join public.meta_ad_accounts account on account.id=adset.meta_ad_account_id
  left join public.meta_ads ad on ad.meta_ad_set_id=adset.id left join public.meta_ad_insights_daily insight
  on insight.meta_ad_id=ad.id and insight.metric_date between $2::date and $3::date
  where adset.project_id=$1 and ($4='' or account.id::text=$4)
  and ($5='' or coalesce(adset.effective_status,adset.status,'')=$5)
  and ($6='' or adset.name ilike '%'||$6||'%') and ($8='' or campaign.id::text=$8) and ($9='' or true) group by adset.id,campaign.id,account.id
  order by sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')) desc nulls last,adset.name`;
 if(level==="ads")sql=`select ad.id,ad.name,coalesce(ad.effective_status,ad.status) status,
  adset.name parent_name,account.name account_name,$7::text currency,null::text budget,
  coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,coalesce(sum(insight.impressions),0)::text impressions,coalesce(sum(insight.reach),0)::text reach,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='link_click'),0)),0)::text clicks,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='landing_page_view'),0)),0)::text landing_page_views,
  coalesce(sum(coalesce((select sum((action->>'value')::numeric) from jsonb_array_elements(case when jsonb_typeof(insight.actions)='array' then insight.actions else '[]'::jsonb end) action
   where action->>'action_type'='initiate_checkout'),0)),0)::text initiate_checkout,campaign.id campaign_id from public.meta_ads ad
  join public.meta_ad_sets adset on adset.id=ad.meta_ad_set_id
  join public.meta_campaigns campaign on campaign.id=ad.meta_campaign_id
  join public.meta_ad_accounts account on account.id=ad.meta_ad_account_id
  left join public.meta_ad_insights_daily insight on insight.meta_ad_id=ad.id
  and insight.metric_date between $2::date and $3::date where ad.project_id=$1
  and ($4='' or account.id::text=$4) and ($5='' or coalesce(ad.effective_status,ad.status,'')=$5)
  and ($6='' or ad.name ilike '%'||$6||'%') and ($8='' or campaign.id::text=$8) and ($9='' or adset.id::text=$9) group by ad.id,adset.id,campaign.id,account.id
  order by sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')) desc nulls last,ad.name`;
 const values=[project.id,from,to,account,status,q,project.currency,campaign,adset];
 const total=Number((await db.pool.query<{total:string}>(`select count(*)::text total from (${sql}) manager_rows`,values)).rows[0]?.total??0);
 const page=Math.min(requestedPage,Math.max(1,Math.ceil(total/PAGE_SIZE)));
 const rows=(await db.pool.query<Row>(`select * from (${sql}) manager_rows limit $10 offset $11`,[...values,PAGE_SIZE,(page-1)*PAGE_SIZE])).rows;
 const accounts=(await db.pool.query<Option>(`select id::text value,name label from public.meta_ad_accounts
  where project_id=$1 order by name`,[project.id])).rows;
 const shared=new URLSearchParams({from,to});if(q)shared.set("q",q);if(account)shared.set("account",account);
 if(status)shared.set("status",status);
 if(campaign)shared.set("campaign",campaign);
 if(adset)shared.set("adset",adset);
 const href=(target:Level)=>{const next=new URLSearchParams(shared);next.set("level",target);
  return `/dashboard/gerenciador-anuncios?${next}`};
 const returnParams=new URLSearchParams(shared);returnParams.set("level",level);returnParams.set("page",String(page));
 const returnTo=`/dashboard/gerenciador-anuncios?${returnParams}`;
 const pageHref=(target:number)=>{const next=new URLSearchParams(returnParams);next.set("page",String(target));return `/dashboard/gerenciador-anuncios?${next}`;};
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/gerenciador-anuncios"
  footerLabel="Meta Ads · operação protegida"/><section className="app-content">
  <DashboardTopbar returnTo="/dashboard/gerenciador-anuncios" statusLabel="Meta Ads · operação governada">
   <Link className="icon-button" href={`/dashboard/campanhas?${shared}`}>Analisar campanhas</Link>
   <Link className="icon-button" href="/dashboard/campanhas/acoes">Aprovações</Link>
  </DashboardTopbar><div className="dashboard-main traffic-workspace ads-manager-workspace">
   {params.notice?<div className={["columns-saved","filters-saved","requested","bulk-requested","edit-requested"].includes(params.notice)?"notice notice-success":"notice notice-error"}>
    {params.notice==="columns-saved"?"Colunas salvas para este projeto e nível.":params.notice==="filters-saved"?"Filtros salvos para este projeto e nível.":params.notice==="requested"?
     "Solicitação enviada para aprovação humana. Nenhuma mudança foi aplicada na Meta.":params.notice==="bulk-requested"?
     "Solicitações em lote enviadas para aprovação humana. Nenhuma mudança foi aplicada na Meta.":"Não foi possível concluir a operação."}</div>:null}
   <header className="dashboard-titlebar compact-titlebar"><div><p className="eyebrow">Operação Meta Ads</p>
    <h1>Gerenciador de anúncios</h1><p className="dashboard-context">Navegue pela estrutura real sincronizada. Alterações continuam bloqueadas até aprovação e escrita Meta.</p>
   </div></header>
   <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Estrutura operacional</p>
    <h2>{levels[level]}</h2></div><span>{total} item(ns) · página {page} de {Math.max(1,Math.ceil(total/PAGE_SIZE))}</span></div>
    <ManagerTable rows={rows} level={level} initialColumns={preference?.columns??[]}
      returnTo={returnTo} projectCurrency={project.currency}
      filters={<form className="inline-filter-form" action={saveManagerFilters}>
       <input type="hidden" name="level" value={level}/><label>Buscar<input defaultValue={q} name="q"
        placeholder={`Nome em ${levels[level].toLowerCase()}`}/></label>
       <DateRangePicker from={from} to={to} max={today}/>
       <label>Conta<select defaultValue={account} name="account"><option value="">Todas</option>
        {accounts.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
       <label>Status<select defaultValue={status} name="status"><option value="">Todos</option>
        {(level==="accounts"?[{value:"1",label:"Ativa"},{value:"2",label:"Desabilitada"},{value:"3",label:"Não liquidada"}]:
         ["ACTIVE","PAUSED","ARCHIVED"].map(value=>({value,label:value}))).map(item=>
          <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
       <button type="submit">Aplicar filtros</button></form>}
      navigation={<nav className="traffic-level-tabs" aria-label="Níveis do gerenciador">{(Object.keys(levels) as Level[]).map(item=>
       <Link className={level===item?"active":""} href={href(item)} key={item}>{levels[item]}</Link>)}</nav>}/>
    {!rows.length?<div className="empty-state"><strong>Nenhum item encontrado</strong>
      <p>Ajuste os filtros ou sincronize novamente a conexão Meta Ads deste projeto.</p>
      <Link href="/dashboard/integracoes">Abrir integrações</Link></div>:null}
    {total>PAGE_SIZE?<nav className="pagination-controls" aria-label="Paginação do gerenciador">
      {page>1?<Link href={pageHref(page-1)}>Anterior</Link>:<span/>}<span>Página {page}</span>
      {page*PAGE_SIZE<total?<Link href={pageHref(page+1)}>Próxima</Link>:<span/>}
    </nav>:null}
   </section></div></section></main>;
}
