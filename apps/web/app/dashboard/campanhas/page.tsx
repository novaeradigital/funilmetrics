import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {buildCampaignRecommendations} from "../../../lib/campaign-recommendations";
import {CampaignColumnManager} from "./campaign-column-manager";
import {DateRangePicker} from "./date-range-picker";
import {calendarDateInTimeZone,shiftCalendarDate} from "../../../lib/calendar-date";

export const dynamic="force-dynamic";
const periods={"7d":7,"30d":30} as const;
const sortOptions={
  spend:"coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0) desc,campaign.name",
  impressions:"coalesce(sum(insight.impressions),0) desc,campaign.name",
  clicks:"coalesce(sum(insight.clicks),0) desc,campaign.name",
  name:"campaign.name",
} as const;
type Row={
  id:string;name:string;status:string|null;effective_status:string|null;
  objective:string|null;account_name:string;currency:string|null;
  spend:string;impressions:string;reach:string;clicks:string;
  ads:number;creatives:number;last_metric_date:string|null;
};
type Daily={day:string;currency:string|null;spend:string;impressions:string;
  reach:string;clicks:string};
type Comparison={currency_count:number;currency:string|null;current_spend:string;
  previous_spend:string;current_impressions:string;previous_impressions:string;
  current_clicks:string;previous_clicks:string};
type FilterOption={value:string;label:string};

export default async function CampaignsPage({
  searchParams,
}:{searchParams:Promise<{period?:string;q?:string;account?:string;status?:string;sort?:string;page?:string;from?:string;to?:string}>}){
  const params=await searchParams;
  const periodKey=params.period&&params.period in periods
    ? params.period as keyof typeof periods:"30d";
  const days=periods[periodKey];
  const search=(params.q??"").trim().slice(0,100);
  const account=/^[0-9a-f-]{36}$/i.test(params.account??"")?params.account!:"";
  const status=(params.status??"").trim().slice(0,50);
  const sortKey=params.sort&&params.sort in sortOptions
    ? params.sort as keyof typeof sortOptions:"spend";
  const orderBy=sortOptions[sortKey];
  const requestedPage=Math.max(1,Number.parseInt(params.page??"1",10)||1);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const today=calendarDateInTimeZone(new Date(),active.project.timezone);
  const dateFrom=/^\d{4}-\d{2}-\d{2}$/.test(params.from??"")
    ?params.from!:shiftCalendarDate(today,-days+1);
  const dateTo=/^\d{4}-\d{2}-\d{2}$/.test(params.to??"")?params.to!:today;
  const database=getDatabase();
  const rows=(await database.pool.query<Row>(
    `select campaign.id,campaign.name,campaign.status,campaign.effective_status,
            campaign.objective,account.name account_name,account.currency,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
            coalesce(sum(insight.impressions),0)::text impressions,
            coalesce(sum(insight.reach),0)::text reach,
            coalesce(sum(insight.clicks),0)::text clicks,
            count(distinct ad.id)::int ads,
            count(distinct ad.meta_creative_id)
              filter(where ad.meta_creative_id is not null)::int creatives,
            max(insight.metric_date)::text last_metric_date
       from public.meta_campaigns campaign
       join public.meta_ad_accounts account
         on account.id=campaign.meta_ad_account_id
       left join public.meta_ads ad on ad.meta_campaign_id=campaign.id
       left join public.meta_ad_insights_daily insight
         on insight.meta_ad_id=ad.id
        and insight.metric_date between $2::date and $6::date
      where campaign.project_id=$1
        and ($3='' or account.id::text=$3)
        and ($4='' or coalesce(campaign.effective_status,campaign.status,'')=$4)
        and ($5='' or campaign.name ilike '%'||$5||'%')
      group by campaign.id,account.id
      order by ${orderBy}`,
    [active.project.id,dateFrom,account,status,search,dateTo],
  )).rows;
  const daily=(await database.pool.query<Daily>(
    `select insight.metric_date::text as "day",account.currency,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
            coalesce(sum(insight.impressions),0)::text impressions,
            coalesce(sum(insight.reach),0)::text reach,
            coalesce(sum(insight.clicks),0)::text clicks
       from public.meta_ad_insights_daily insight
       join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
       join public.meta_ads ad on ad.id=insight.meta_ad_id
       join public.meta_campaigns campaign on campaign.id=ad.meta_campaign_id
      where insight.project_id=$1
        and insight.metric_date between $2::date and $6::date
        and ($3='' or account.id::text=$3)
        and ($4='' or coalesce(campaign.effective_status,campaign.status,'')=$4)
        and ($5='' or campaign.name ilike '%'||$5||'%')
      group by insight.metric_date,account.currency
      order by insight.metric_date`,
    [active.project.id,dateFrom,account,status,search,dateTo],
  )).rows;
  const comparison=(await database.pool.query<Comparison>(
    `select count(distinct account.currency)
              filter(where insight.metric_date>=current_date-$2::int+1)::int currency_count,
            max(account.currency)
              filter(where insight.metric_date>=current_date-$2::int+1) currency,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required'))
              filter(where insight.metric_date>=current_date-$2::int+1),0)::text current_spend,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required'))
              filter(where insight.metric_date<current_date-$2::int+1),0)::text previous_spend,
            coalesce(sum(insight.impressions)
              filter(where insight.metric_date>=current_date-$2::int+1),0)::text current_impressions,
            coalesce(sum(insight.impressions)
              filter(where insight.metric_date<current_date-$2::int+1),0)::text previous_impressions,
            coalesce(sum(insight.clicks)
              filter(where insight.metric_date>=current_date-$2::int+1),0)::text current_clicks,
            coalesce(sum(insight.clicks)
              filter(where insight.metric_date<current_date-$2::int+1),0)::text previous_clicks
       from public.meta_ad_insights_daily insight
       join public.meta_ad_accounts account on account.id=insight.meta_ad_account_id
       join public.meta_ads ad on ad.id=insight.meta_ad_id
       join public.meta_campaigns campaign on campaign.id=ad.meta_campaign_id
      where insight.project_id=$1
        and insight.metric_date>=current_date-($2::int*2)+1
        and ($3='' or account.id::text=$3)
        and ($4='' or coalesce(campaign.effective_status,campaign.status,'')=$4)
        and ($5='' or campaign.name ilike '%'||$5||'%')`,
    [active.project.id,days,account,status,search],
  )).rows[0];
  const accounts=(await database.pool.query<FilterOption>(
    `select id::text value,name label from public.meta_ad_accounts
      where project_id=$1 order by name`,
    [active.project.id],
  )).rows;
  const statuses=(await database.pool.query<FilterOption>(
    `select distinct coalesce(effective_status,status) value,
            coalesce(effective_status,status) label
       from public.meta_campaigns
      where project_id=$1 and coalesce(effective_status,status) is not null
      order by 1`,
    [active.project.id],
  )).rows;
  const summary=rows.reduce((total,row)=>({
    spend:total.spend+Number(row.spend),
    impressions:total.impressions+Number(row.impressions),
    reach:total.reach+Number(row.reach),
    clicks:total.clicks+Number(row.clicks),
  }),{spend:0,impressions:0,reach:0,clicks:0});
  const money=(value:number,currency="BRL")=>new Intl.NumberFormat("pt-BR",{
    style:"currency",currency,
  }).format(value);
  const currencies=[...new Set(rows.map((row)=>row.currency).filter(Boolean))] as string[];
  const currency=currencies.length===1?currencies[0]!:active.project.currency;
  const comparableCurrency=currencies.length<=1;
  const delta=(current:number,previous:number)=>previous
    ? `${current>=previous?"+":""}${((current-previous)/previous*100).toFixed(1)}%`
    : current>0?"novo":"—";
  const maxSpendByCurrency=daily.reduce<Record<string,number>>((result,item)=>{
    const key=item.currency||active.project!.currency;
    result[key]=Math.max(result[key]??0,Number(item.spend));return result;
  },{});
  const exportParams=new URLSearchParams({period:periodKey});
  exportParams.set("from",dateFrom);exportParams.set("to",dateTo);
  if(search)exportParams.set("q",search);
  if(account)exportParams.set("account",account);
  if(status)exportParams.set("status",status);
  const pageSize=25;
  const totalPages=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(requestedPage,totalPages);
  const visibleRows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const recommendations=buildCampaignRecommendations(rows.map((row)=>({
    id:row.id,name:row.name,effectiveStatus:row.effective_status??row.status,
    currency:row.currency,spend:Number(row.spend),impressions:Number(row.impressions),
    clicks:Number(row.clicks),
  })));
  const pageHref=(page:number)=>{
    const query=new URLSearchParams({period:periodKey,sort:sortKey,page:String(page)});
    query.set("from",dateFrom);query.set("to",dateTo);
    if(search)query.set("q",search);
    if(account)query.set("account",account);
    if(status)query.set("status",status);
    return `/dashboard/campanhas?${query.toString()}`;
  };
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/campanhas" footerLabel="Meta Ads · leitura"/>
  <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas" statusLabel="Meta Ads · leitura">
      <Link className="icon-button" href={`/dashboard/gerenciador-anuncios?${exportParams.toString()}`}>Gerenciador de anúncios</Link>
      <Link className="icon-button" href="/dashboard/campanhas/acoes">Aprovações</Link>
      <a className="icon-button" href={`/dashboard/campanhas/export?${exportParams.toString()}`}>Exportar CSV</a>
      <Link className="icon-button" href="/dashboard/campanhas/criativos">Criativos</Link>
      <form className="period-filter topbar-period" method="get">
        <input name="q" type="hidden" value={search}/><input name="account" type="hidden" value={account}/>
        <input name="status" type="hidden" value={status}/><input name="sort" type="hidden" value={sortKey}/>
        {Object.entries(periods).map(([key,value])=><button className={periodKey===key?"active":""}
          key={key} name="period" value={key}>{value} dias</button>)}
      </form>
    </DashboardTopbar>
    <div className="dashboard-main traffic-workspace"><header className="dashboard-titlebar compact-titlebar traffic-titlebar"><div>
      <p className="eyebrow">Meta Ads · desempenho observado</p><h1>Campanhas</h1>
      <p className="dashboard-context">Métricas importadas das contas explicitamente autorizadas. Nenhuma campanha é alterada por esta tela.</p>
    </div></header>
    <section className="dashboard-panel"><form className="inline-filter-form" method="get">
      <input name="period" type="hidden" value={periodKey}/>
      <label>Buscar<input defaultValue={search} name="q" placeholder="Nome da campanha"/></label>
      <DateRangePicker from={dateFrom} to={dateTo} max={today}/>
      <label>Conta<select defaultValue={account} name="account"><option value="">Todas</option>
        {accounts.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      <label>Status<select defaultValue={status} name="status"><option value="">Todos</option>
        {statuses.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      <label>Ordenar<select defaultValue={sortKey} name="sort">
        <option value="spend">Maior investimento</option>
        <option value="impressions">Mais impressões</option>
        <option value="clicks">Mais cliques</option>
        <option value="name">Nome</option>
      </select></label>
      <button type="submit">Aplicar filtros</button>
      {search||account||status?<Link className="icon-button" href={`/dashboard/campanhas?period=${periodKey}`}>Limpar</Link>:null}
    </form></section>
    <section className="kpi-grid traffic-kpi-grid">
      <article><span>Investimento</span><strong>{comparableCurrency?money(summary.spend,currency):"Múltiplas moedas"}</strong>
        <small>{comparison?.currency_count===1?`${delta(Number(comparison.current_spend),Number(comparison.previous_spend))} vs. período anterior`:"comparação financeira indisponível"}</small></article>
      <article><span>Impressões</span><strong>{summary.impressions.toLocaleString("pt-BR")}</strong>
        <small>{comparison?`${delta(Number(comparison.current_impressions),Number(comparison.previous_impressions))} vs. período anterior`:"—"}</small></article>
      <article><span>Cliques</span><strong>{summary.clicks.toLocaleString("pt-BR")}</strong>
        <small>{comparison?`${delta(Number(comparison.current_clicks),Number(comparison.previous_clicks))} vs. período anterior`:"—"}</small></article>
      <article><span>CTR</span><strong>{summary.impressions?`${(summary.clicks/summary.impressions*100).toFixed(2)}%`:"—"}</strong></article>
      <article><span>CPC</span><strong>{comparableCurrency&&summary.clicks?money(summary.spend/summary.clicks,currency):"—"}</strong></article>
    </section>
    <details className="dashboard-panel collapsible-analysis"><summary className="panel-heading"><div>
      <p className="panel-label">Leitura assistida · regra v1</p><h2>Recomendações observadas</h2>
    </div><span>{recommendations.length} sinal(is) · abrir</span></summary>
    {recommendations.length?<div className="alerts-list">{recommendations.map((item)=>
      <article className={`alert-card alert-${item.severity==="attention"?"warning":"info"}`}
        key={`${item.campaignId}:${item.code}`}>
        <span className="alert-severity">{item.severity==="attention"?"Atenção":"Informativo"}</span>
        <div><h2>{item.campaignName}</h2><p className="alert-evidence">{item.evidence}</p></div>
        <div className="alert-guidance"><p><strong>Próxima análise</strong>{item.recommendation}</p></div>
        <Link href={`/dashboard/campanhas/${item.campaignId}?period=${periodKey}`}>Ver evidências →</Link>
      </article>)}</div>:<div className="empty-state"><strong>Nenhum sinal acionado</strong>
      <p>As campanhas não atingiram os critérios conservadores desta regra no período selecionado.</p></div>}
    <div className="method-note"><strong>Sem ação automática</strong><p>Os sinais comparam somente campanhas da mesma moeda e exigem volume mínimo. Não provam causa, não declaram vencedor e não alteram a Meta Ads.</p></div>
    </details>
    <details className="dashboard-panel collapsible-analysis"><summary className="panel-heading"><div>
      <p className="panel-label">Série diária</p><h2>Evolução de investimento e entrega</h2>
    </div><span>{days} dias · abrir</span></summary>
    {daily.length?<div className="table-shell"><table><thead><tr><th>Data</th>
      <th>Moeda</th><th>Investimento</th><th>Impressões</th><th>Alcance</th>
      <th>Cliques</th><th>CTR</th><th>CPC</th></tr></thead><tbody>{daily.map((item)=>{
        const spend=Number(item.spend),impressions=Number(item.impressions);
        const reach=Number(item.reach),clicks=Number(item.clicks);
        const rowCurrency=item.currency||active.project!.currency;
        const width=maxSpendByCurrency[rowCurrency]?spend/maxSpendByCurrency[rowCurrency]*100:0;
        return <tr key={`${item.day}:${rowCurrency}`}><td><strong>{new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${item.day}T00:00:00Z`))}</strong>
          <span aria-hidden="true" style={{display:"block",height:3,marginTop:6,
            width:`${width}%`,background:"#65e5aa"}}/></td>
          <td>{rowCurrency}</td><td>{money(spend,rowCurrency)}</td>
          <td>{impressions.toLocaleString("pt-BR")}</td><td>{reach.toLocaleString("pt-BR")}</td>
          <td>{clicks.toLocaleString("pt-BR")}</td>
          <td>{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
          <td>{clicks?money(spend/clicks,rowCurrency):"—"}</td></tr>;
      })}</tbody></table></div>:<div className="empty-state"><strong>Sem série diária</strong>
      <p>Sincronize os insights Meta para preencher a evolução do período.</p></div>}
    </details>
    <section className="dashboard-panel"><div className="panel-heading"><div>
      <p className="panel-label">Análise comparativa</p><h2>Desempenho por campanha</h2>
    </div><span>{rows.length} campanha(s) · página {currentPage} de {totalPages}</span></div>
    {rows.length?<CampaignColumnManager storageKey={`campaign-columns:${active.project.id}`}>
      <div className="table-shell"><table><thead><tr>
      <th>Campanha</th><th className="col-status">Status</th><th className="col-structure">Estrutura</th><th className="col-spend">Investimento</th>
      <th className="col-impressions">Impressões</th><th className="col-clicks">Cliques</th><th className="col-ctr">CTR</th><th className="col-cpc">CPC</th>
    </tr></thead><tbody>{visibleRows.map((row)=>{
      const spend=Number(row.spend),impressions=Number(row.impressions),clicks=Number(row.clicks);
      return <tr key={row.id}><td><Link href={`/dashboard/campanhas/${row.id}?period=${periodKey}`}><strong>{row.name}</strong></Link>
        <small>{row.account_name} · {row.objective||"objetivo não informado"}</small>
        <small>{row.last_metric_date?`Última métrica: ${new Intl.DateTimeFormat("pt-BR",{
          timeZone:"UTC",
        }).format(new Date(`${row.last_metric_date}T00:00:00Z`))}`:"Sem métricas no período"}</small></td>
        <td className="col-status">{row.effective_status||row.status||"—"}</td>
        <td className="col-structure">{row.ads} anúncio(s)<small>{row.creatives} criativo(s)</small></td>
        <td className="col-spend">{money(spend,row.currency||currency)}</td>
        <td className="col-impressions">{impressions.toLocaleString("pt-BR")}</td>
        <td className="col-clicks">{clicks.toLocaleString("pt-BR")}</td>
        <td className="col-ctr">{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
        <td className="col-cpc">{clicks?money(spend/clicks,row.currency||currency):"—"}</td></tr>;
    })}</tbody></table>
      {totalPages>1?<nav aria-label="Paginação das campanhas" className="period-filter">
        {currentPage>1?<Link href={pageHref(currentPage-1)}>Anterior</Link>:null}
        <span>{(currentPage-1)*pageSize+1}–{Math.min(currentPage*pageSize,rows.length)} de {rows.length}</span>
        {currentPage<totalPages?<Link href={pageHref(currentPage+1)}>Próxima</Link>:null}
      </nav>:null}</div></CampaignColumnManager>:<div className="empty-state">
      <strong>{search||account||status?"Nenhuma campanha encontrada":"Nenhuma campanha sincronizada"}</strong>
      <p>{search||account||status
        ?"Ajuste ou limpe os filtros para consultar o restante do catálogo."
        :"Conecte a Meta Ads em Integrações e use “Validar e sincronizar esta conexão”."}</p>
      {search||account||status
        ?<Link href={`/dashboard/campanhas?period=${periodKey}`}>Limpar filtros</Link>
        :<Link href="/dashboard/integracoes">Abrir integrações</Link>}</div>}
    </section></div></section></main>;
}
