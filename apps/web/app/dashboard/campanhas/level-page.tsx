import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {DateRangePicker} from "./date-range-picker";
import {calendarDateInTimeZone,shiftCalendarDate} from "../../../lib/calendar-date";

type Level="adsets"|"ads";
type Params={period?:string;q?:string;account?:string;status?:string;from?:string;to?:string};
type Row={id:string;name:string;status:string|null;effective_status:string|null;
  parent_name:string;campaign_name:string;account_name:string;currency:string|null;
  budget:string|null;spend:string;impressions:string;clicks:string};
type Option={value:string;label:string};

const iso=(value:string|undefined)=>/^\d{4}-\d{2}-\d{2}$/.test(value??"")?value!:null;

export async function MetaLevelPage({level,searchParams}:{
  level:Level;searchParams:Promise<Params>;
}){
  const params=await searchParams;
  const preset=params.period==="7d"?7:30;
  const q=(params.q??"").trim().slice(0,100);
  const account=/^[0-9a-f-]{36}$/i.test(params.account??"")?params.account!:"";
  const status=(params.status??"").trim().slice(0,50);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const today=calendarDateInTimeZone(new Date(),active.project.timezone);
  const from=iso(params.from)??shiftCalendarDate(today,-preset+1);
  const to=iso(params.to)??today;
  const db=getDatabase();
  const source=level==="adsets"?"public.meta_ad_sets adset":"public.meta_ads ad";
  const id=level==="adsets"?"adset":"ad";
  const joins=level==="adsets"
    ?`join public.meta_campaigns campaign on campaign.id=adset.meta_campaign_id
      join public.meta_ad_accounts account on account.id=adset.meta_ad_account_id
      left join public.meta_ads ad on ad.meta_ad_set_id=adset.id`
    :`join public.meta_ad_sets adset on adset.id=ad.meta_ad_set_id
      join public.meta_campaigns campaign on campaign.id=ad.meta_campaign_id
      join public.meta_ad_accounts account on account.id=ad.meta_ad_account_id`;
  const rows=(await db.pool.query<Row>(`
    select ${id}.id,${id}.name,${id}.status,${id}.effective_status,
           ${level==="ads"?"adset.name":"campaign.name"} parent_name,
           campaign.name campaign_name,account.name account_name,account.currency,
           ${level==="adsets"
             ?"coalesce(adset.daily_budget_minor,adset.lifetime_budget_minor)::text"
             :"null::text"} budget,
           coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
           coalesce(sum(insight.impressions),0)::text impressions,
           coalesce(sum(insight.clicks),0)::text clicks
      from ${source} ${joins}
      left join public.meta_ad_insights_daily insight on insight.meta_ad_id=ad.id
       and insight.metric_date between $2::date and $3::date
     where ${id}.project_id=$1 and ($4='' or account.id::text=$4)
       and ($5='' or coalesce(${id}.effective_status,${id}.status,'')=$5)
       and ($6='' or ${id}.name ilike '%'||$6||'%')
     group by ${id}.id,adset.id,campaign.id,account.id
     order by coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0) desc,${id}.name`,
    [active.project.id,from,to,account,status,q])).rows;
  const accounts=(await db.pool.query<Option>(
    `select id::text value,name label from public.meta_ad_accounts
      where project_id=$1 order by name`,[active.project.id])).rows;
  const title=level==="adsets"?"conjunto":"anúncio";
  const money=(value:number,currency:string)=>new Intl.NumberFormat("pt-BR",
    {style:"currency",currency:currency||active.project!.currency}).format(value);
  const shared=new URLSearchParams({from,to});if(account)shared.set("account",account);
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/campanhas" footerLabel="Meta Ads · leitura"/>
    <section className="app-content"><DashboardTopbar returnTo="/dashboard/campanhas" statusLabel="Meta Ads · leitura"/>
    <div className="dashboard-main traffic-workspace">
      <nav className="traffic-level-tabs"><span>Contas</span>
        <Link href={`/dashboard/campanhas?${shared}`}>Campanhas</Link>
        <Link className={level==="adsets"?"active":""} href={`/dashboard/campanhas/conjuntos?${shared}`}>Conjuntos</Link>
        <Link className={level==="ads"?"active":""} href={`/dashboard/campanhas/anuncios?${shared}`}>Anúncios</Link>
      </nav>
      <section className="dashboard-panel"><form className="inline-filter-form" method="get">
        <label>Buscar<input defaultValue={q} name="q" placeholder={`Nome do ${title}`}/></label>
        <DateRangePicker from={from} to={to} max={today}/>
        <label>Conta<select defaultValue={account} name="account"><option value="">Todas</option>
          {accounts.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>Status<select defaultValue={status} name="status"><option value="">Todos</option>
          {["ACTIVE","PAUSED","ARCHIVED"].map(item=><option key={item}>{item}</option>)}</select></label>
        <button type="submit">Aplicar filtros</button>
      </form></section>
      <section className="dashboard-panel"><div className="panel-heading"><div>
        <p className="panel-label">Gerenciador de mídia</p><h2>Desempenho por {title}</h2>
      </div><span>{rows.length} {title}(s)</span></div>
      <div className="table-shell"><table><thead><tr><th>{title}</th><th>Status</th>
        <th>{level==="ads"?"Conjunto":"Campanha"}</th>{level==="ads"?<th>Campanha</th>:null}
        {level==="adsets"?<th>Orçamento</th>:null}<th>Gastos</th><th>Impressões</th>
        <th>Cliques</th><th>CTR</th><th>CPC</th></tr></thead><tbody>
        {rows.map(row=>{const spend=Number(row.spend),impressions=Number(row.impressions),
          clicks=Number(row.clicks),currency=row.currency||active.project!.currency;
          return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.account_name}</small></td>
            <td>{row.effective_status||row.status||"—"}</td><td>{row.parent_name}</td>
            {level==="ads"?<td>{row.campaign_name}</td>:null}
            {level==="adsets"?<td>{row.budget?money(Number(row.budget)/100,currency):"—"}</td>:null}
            <td>{money(spend,currency)}</td><td>{impressions.toLocaleString("pt-BR")}</td>
            <td>{clicks.toLocaleString("pt-BR")}</td>
            <td>{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
            <td>{clicks?money(spend/clicks,currency):"—"}</td></tr>})}
      </tbody></table></div></section>
    </div></section></main>;
}
