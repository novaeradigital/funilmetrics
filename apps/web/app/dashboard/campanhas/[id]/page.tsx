import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getDatabase} from "../../../../lib/database";
import {getActiveProject} from "../../../../lib/active-project";
import {signOut} from "../../actions";
import {ProjectSwitcher} from "../../project-switcher";
import {DashboardSidebar} from "../../dashboard-sidebar";

export const dynamic="force-dynamic";
const periods={"7d":7,"30d":30} as const;
type Campaign={id:string;name:string;status:string|null;effective_status:string|null;
  objective:string|null;account_name:string;currency:string|null};
type AdRow={id:string;name:string;status:string|null;effective_status:string|null;
  ad_set_name:string;creative_name:string|null;creative_external_id:string|null;
  spend:string;impressions:string;reach:string;clicks:string;last_metric_date:string|null};
type Daily={day:string;spend:string;impressions:string;reach:string;clicks:string};
type Comparison={current_spend:string;previous_spend:string;
  current_impressions:string;previous_impressions:string;
  current_reach:string;previous_reach:string;
  current_clicks:string;previous_clicks:string};

export default async function CampaignDetail({
  params,searchParams,
}:{params:Promise<{id:string}>;searchParams:Promise<{period?:string;page?:string}>}){
  const {id}=await params;const query=await searchParams;
  if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
  const periodKey=query.period&&query.period in periods
    ? query.period as keyof typeof periods:"30d";
  const days=periods[periodKey];
  const requestedPage=Math.max(1,Number.parseInt(query.page??"1",10)||1);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const campaign=(await database.pool.query<Campaign>(
    `select campaign.id,campaign.name,campaign.status,campaign.effective_status,
            campaign.objective,account.name account_name,account.currency
       from public.meta_campaigns campaign
       join public.meta_ad_accounts account on account.id=campaign.meta_ad_account_id
      where campaign.id=$1 and campaign.project_id=$2 limit 1`,
    [id,active.project.id],
  )).rows[0];
  if(!campaign)notFound();
  const rows=(await database.pool.query<AdRow>(
    `select ad.id,ad.name,ad.status,ad.effective_status,
            ad_set.name ad_set_name,creative.name creative_name,
            creative.external_id creative_external_id,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
            coalesce(sum(insight.impressions),0)::text impressions,
            coalesce(sum(insight.reach),0)::text reach,
            coalesce(sum(insight.clicks),0)::text clicks,
            max(insight.metric_date)::text last_metric_date
       from public.meta_ads ad
       join public.meta_ad_sets ad_set on ad_set.id=ad.meta_ad_set_id
       left join public.meta_creatives creative on creative.id=ad.meta_creative_id
       left join public.meta_ad_insights_daily insight
         on insight.meta_ad_id=ad.id
        and insight.metric_date>=current_date-$3::int+1
      where ad.meta_campaign_id=$1 and ad.project_id=$2
      group by ad.id,ad_set.id,creative.id
      order by coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0) desc,ad.name`,
    [id,active.project.id,days],
  )).rows;
  const daily=(await database.pool.query<Daily>(
    `select insight.metric_date::text day,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
            coalesce(sum(insight.impressions),0)::text impressions,
            coalesce(sum(insight.reach),0)::text reach,
            coalesce(sum(insight.clicks),0)::text clicks
       from public.meta_ad_insights_daily insight
       join public.meta_ads ad on ad.id=insight.meta_ad_id
      where ad.meta_campaign_id=$1 and insight.project_id=$2
        and insight.metric_date>=current_date-$3::int+1
      group by insight.metric_date
      order by insight.metric_date`,
    [id,active.project.id,days],
  )).rows;
  const comparison=(await database.pool.query<Comparison>(
    `select coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')
              and insight.metric_date>=current_date-$3::int+1),0)::text current_spend,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')
              and insight.metric_date<current_date-$3::int+1),0)::text previous_spend,
            coalesce(sum(insight.impressions)
              filter(where insight.metric_date>=current_date-$3::int+1),0)::text current_impressions,
            coalesce(sum(insight.impressions)
              filter(where insight.metric_date<current_date-$3::int+1),0)::text previous_impressions,
            coalesce(sum(insight.reach)
              filter(where insight.metric_date>=current_date-$3::int+1),0)::text current_reach,
            coalesce(sum(insight.reach)
              filter(where insight.metric_date<current_date-$3::int+1),0)::text previous_reach,
            coalesce(sum(insight.clicks)
              filter(where insight.metric_date>=current_date-$3::int+1),0)::text current_clicks,
            coalesce(sum(insight.clicks)
              filter(where insight.metric_date<current_date-$3::int+1),0)::text previous_clicks
       from public.meta_ad_insights_daily insight
       join public.meta_ads ad on ad.id=insight.meta_ad_id
      where ad.meta_campaign_id=$1 and insight.project_id=$2
        and insight.metric_date>=current_date-($3::int*2)+1`,
    [id,active.project.id,days],
  )).rows[0];
  const summary=rows.reduce((total,row)=>({
    spend:total.spend+Number(row.spend),impressions:total.impressions+Number(row.impressions),
    reach:total.reach+Number(row.reach),clicks:total.clicks+Number(row.clicks),
  }),{spend:0,impressions:0,reach:0,clicks:0});
  const currency=campaign.currency||active.project.currency;
  const money=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency}).format(value);
  const delta=(current:number,previous:number)=>previous
    ? `${current>=previous?"+":""}${((current-previous)/previous*100).toFixed(1)}%`
    : current>0?"novo":"—";
  const maxDailySpend=daily.reduce((maximum,item)=>Math.max(maximum,Number(item.spend)),0);
  const pageSize=25;
  const totalPages=Math.max(1,Math.ceil(rows.length/pageSize));
  const currentPage=Math.min(requestedPage,totalPages);
  const visibleRows=rows.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const pageHref=(page:number)=>`/dashboard/campanhas/${id}?period=${periodKey}&page=${page}`;
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/campanhas" footerLabel="Somente leitura"/>
  <section className="app-content">
    <header className="app-topbar"><ProjectSwitcher returnTo={`/dashboard/campanhas/${id}?period=${periodKey}`}/>
      <div className="topbar-actions"><Link className="icon-button" href={`/dashboard/campanhas?period=${periodKey}`}>Voltar</Link>
        <form action={signOut}><button className="icon-button">Sair</button></form></div></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div>
      <p className="eyebrow">Meta Ads · campanha</p><h1>{campaign.name}</h1>
      <p className="dashboard-context">{campaign.account_name} · {campaign.objective||"Objetivo não informado"} · {campaign.effective_status||campaign.status||"Status não informado"}</p>
    </div><div className="topbar-actions"><a className="icon-button"
      href={`/dashboard/campanhas/${id}/export?period=${periodKey}`}>Exportar CSV</a>
      <form className="period-filter" method="get">
      {Object.entries(periods).map(([key,value])=><button className={key===periodKey?"active":""}
        key={key} name="period" value={key}>{value} dias</button>)}</form></div></header>
    <section className="kpi-grid">
      <article><span>Investimento</span><strong>{money(summary.spend)}</strong>
        <small>{comparison?`${delta(Number(comparison.current_spend),Number(comparison.previous_spend))} vs. período anterior`:"—"}</small></article>
      <article><span>Impressões</span><strong>{summary.impressions.toLocaleString("pt-BR")}</strong>
        <small>{comparison?`${delta(Number(comparison.current_impressions),Number(comparison.previous_impressions))} vs. período anterior`:"—"}</small></article>
      <article><span>Alcance</span><strong>{summary.reach.toLocaleString("pt-BR")}</strong>
        <small>{comparison?`${delta(Number(comparison.current_reach),Number(comparison.previous_reach))} vs. período anterior`:"—"}</small></article>
      <article><span>Cliques</span><strong>{summary.clicks.toLocaleString("pt-BR")}</strong>
        <small>{comparison?`${delta(Number(comparison.current_clicks),Number(comparison.previous_clicks))} vs. período anterior`:"—"}</small></article>
      <article><span>CTR</span><strong>{summary.impressions?`${(summary.clicks/summary.impressions*100).toFixed(2)}%`:"—"}</strong></article>
      <article><span>CPC</span><strong>{summary.clicks?money(summary.spend/summary.clicks):"—"}</strong></article>
    </section>
    <section className="dashboard-panel"><div className="panel-heading"><div>
      <p className="panel-label">Série diária</p><h2>Evolução da campanha</h2>
    </div><span>{days} dias · {currency}</span></div>
    {daily.length?<div className="table-shell"><table><thead><tr><th>Data</th>
      <th>Investimento</th><th>Impressões</th><th>Alcance</th><th>Cliques</th>
      <th>CTR</th><th>CPC</th></tr></thead><tbody>{daily.map((item)=>{
        const spend=Number(item.spend),impressions=Number(item.impressions);
        const reach=Number(item.reach),clicks=Number(item.clicks);
        const width=maxDailySpend?spend/maxDailySpend*100:0;
        return <tr key={item.day}><td><strong>{new Intl.DateTimeFormat("pt-BR",{
          timeZone:"UTC",
        }).format(new Date(`${item.day}T00:00:00Z`))}</strong>
          <span aria-hidden="true" style={{display:"block",height:3,marginTop:6,
            width:`${width}%`,background:"#65e5aa"}}/></td>
          <td>{money(spend)}</td><td>{impressions.toLocaleString("pt-BR")}</td>
          <td>{reach.toLocaleString("pt-BR")}</td><td>{clicks.toLocaleString("pt-BR")}</td>
          <td>{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
          <td>{clicks?money(spend/clicks):"—"}</td></tr>;
      })}</tbody></table></div>:<div className="empty-state"><strong>Sem série diária</strong>
      <p>Sincronize os insights Meta para preencher a evolução desta campanha.</p></div>}
    </section>
    <section className="dashboard-panel"><div className="panel-heading"><div>
      <p className="panel-label">Anúncios e criativos</p><h2>Desempenho observado</h2>
    </div><span>{rows.length} anúncio(s) · página {currentPage} de {totalPages}</span></div>
    {rows.length?<div className="table-shell"><table><thead><tr><th>Anúncio</th>
      <th>Conjunto</th><th>Status</th><th>Investimento</th><th>Impressões</th>
      <th>Cliques</th><th>CTR</th><th>CPC</th></tr></thead><tbody>
      {visibleRows.map((row)=>{
        const spend=Number(row.spend),impressions=Number(row.impressions),clicks=Number(row.clicks);
        return <tr key={row.id}><td><strong>{row.name}</strong>
          <small>{row.creative_name||"Criativo sem nome"}{row.creative_external_id?` · ${row.creative_external_id}`:""}</small></td>
          <td>{row.ad_set_name}</td><td>{row.effective_status||row.status||"—"}</td>
          <td>{money(spend)}</td><td>{impressions.toLocaleString("pt-BR")}</td>
          <td>{clicks.toLocaleString("pt-BR")}</td>
          <td>{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
          <td>{clicks?money(spend/clicks):"—"}</td></tr>;
      })}</tbody></table>
        {totalPages>1?<nav aria-label="Paginação dos anúncios" className="period-filter">
          {currentPage>1?<Link href={pageHref(currentPage-1)}>Anterior</Link>:null}
          <span>{(currentPage-1)*pageSize+1}–{Math.min(currentPage*pageSize,rows.length)} de {rows.length}</span>
          {currentPage<totalPages?<Link href={pageHref(currentPage+1)}>Próxima</Link>:null}
        </nav>:null}</div>:<div className="empty-state"><strong>Nenhum anúncio sincronizado</strong>
        <p>Execute novamente a sincronização da conexão Meta deste projeto.</p></div>}
    </section></div></section></main>;
}
