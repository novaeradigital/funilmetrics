import {redirect} from "next/navigation";
import {createClient} from "../../../../lib/supabase/server";
import {getDatabase} from "../../../../lib/database";
import {getActiveProject} from "../../../../lib/active-project";
import {DashboardSidebar} from "../../dashboard-sidebar";
import {DashboardTopbar} from "../../dashboard-topbar";
import {linkMetaCreative} from "./actions";

export const dynamic="force-dynamic";
const periods={"7d":7,"30d":30} as const;
type Row={id:string;external_id:string;name:string|null;account_name:string;
  currency:string|null;ads:number;campaigns:number;spend:string;impressions:string;
  reach:string;clicks:string;last_metric_date:string|null;linked_ads:number;
  internal_creative_name:string|null;internal_version_number:number|null};
type Option={version_id:string;creative_name:string;version_number:number};

export default async function MetaCreatives({
  searchParams,
}:{searchParams:Promise<{period?:string;status?:string}>}){
  const query=await searchParams;const periodKey=query.period&&query.period in periods
    ? query.period as keyof typeof periods:"30d";const days=periods[periodKey];
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const active=await getActiveProject(data.user.id);
  if(!active.project)redirect("/dashboard/projetos");
  const database=getDatabase();
  const rows=(await database.pool.query<Row>(
    `select creative.id,creative.external_id,creative.name,
            account.name account_name,account.currency,
            count(distinct ad.id)::int ads,
            count(distinct ad.meta_campaign_id)::int campaigns,
            count(distinct link.meta_ad_id)::int linked_ads,
            max(internal.name) internal_creative_name,
            max(version.version_number)::int internal_version_number,
            coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0)::text spend,
            coalesce(sum(insight.impressions),0)::text impressions,
            coalesce(sum(insight.reach),0)::text reach,
            coalesce(sum(insight.clicks),0)::text clicks,
            max(insight.metric_date)::text last_metric_date
       from public.meta_creatives creative
       join public.meta_ad_accounts account on account.id=creative.meta_ad_account_id
       left join public.meta_ads ad on ad.meta_creative_id=creative.id
       left join public.creative_ad_links link on link.meta_ad_id=ad.id
       left join public.creatives internal on internal.id=link.creative_id
       left join public.creative_versions version on version.id=link.creative_version_id
       left join public.meta_ad_insights_daily insight on insight.meta_ad_id=ad.id
        and insight.metric_date>=current_date-$2::int+1
      where creative.project_id=$1
      group by creative.id,account.id
      order by coalesce(sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required')),0) desc,creative.name`,
    [active.project.id,days],
  )).rows;
  const options=(await database.pool.query<Option>(
    `select version.id version_id,creative.name creative_name,version.version_number
       from public.creative_versions version
       join public.creatives creative on creative.id=version.creative_id
      where version.project_id=$1
      order by creative.name,version.version_number desc`,
    [active.project.id],
  )).rows;
  const money=(value:number,currency:string|null)=>new Intl.NumberFormat("pt-BR",{
    style:"currency",currency:currency||active.project!.currency,
  }).format(value);
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/campanhas/criativos" footerLabel="Dados observados"/>
  <section className="app-content">
    <DashboardTopbar returnTo="/dashboard/campanhas/criativos" statusLabel="Dados observados"/>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div>
      <p className="eyebrow">Meta Ads · criativos externos</p><h1>Desempenho de criativos</h1>
      <p className="dashboard-context">Consolidação por ID do criativo na Meta. Esses registros não substituem os arquivos versionados da biblioteca própria.</p>
    </div><form className="period-filter" method="get">
      {Object.entries(periods).map(([key,value])=><button className={key===periodKey?"active":""}
        key={key} name="period" value={key}>{value} dias</button>)}</form></header>
    {query.status==="linked"?<div className="notice notice-success">Criativo da Meta ligado à versão da biblioteca e registrado na auditoria.</div>:null}
    {query.status&&query.status!=="linked"?<div className="notice notice-error">Não foi possível concluir a ligação: {query.status}.</div>:null}
    <section className="dashboard-panel"><div className="panel-heading"><div>
      <p className="panel-label">Ranking por investimento</p><h2>Peças sincronizadas</h2>
    </div><span>{rows.length} criativo(s)</span></div>
    {rows.length?<div className="table-shell"><table><thead><tr><th>Criativo</th>
      <th>Uso</th><th>Biblioteca própria</th><th>Investimento</th><th>Impressões</th><th>Cliques</th>
      <th>CTR</th><th>CPC</th></tr></thead><tbody>{rows.map((row)=>{
        const spend=Number(row.spend),impressions=Number(row.impressions),clicks=Number(row.clicks);
        return <tr key={row.id}><td><strong>{row.name||"Criativo sem nome"}</strong>
          <small>{row.external_id} · {row.account_name}</small></td>
          <td>{row.ads} anúncio(s)<small>{row.campaigns} campanha(s)</small></td>
          <td>{row.internal_creative_name?<><strong>{row.internal_creative_name}</strong>
            <small>Versão {row.internal_version_number} · {row.linked_ads}/{row.ads} anúncio(s) ligados</small></>:options.length?
            <form action={linkMetaCreative}><input name="meta_creative_id" type="hidden" value={row.id}/>
              <select aria-label="Versão da biblioteca" name="creative_version_id" required>
                <option value="">Selecionar versão</option>{options.map((option)=>
                  <option key={option.version_id} value={option.version_id}>{option.creative_name} · v{option.version_number}</option>)}
              </select><button type="submit">Ligar</button></form>:<small>Nenhuma versão interna disponível</small>}</td>
          <td>{money(spend,row.currency)}</td><td>{impressions.toLocaleString("pt-BR")}</td>
          <td>{clicks.toLocaleString("pt-BR")}</td>
          <td>{impressions?`${(clicks/impressions*100).toFixed(2)}%`:"—"}</td>
          <td>{clicks?money(spend/clicks,row.currency):"—"}</td></tr>;
      })}</tbody></table></div>:<div className="empty-state"><strong>Nenhum criativo Meta sincronizado</strong>
        <p>Execute a sincronização da conexão Meta para preencher este ranking.</p></div>}
    </section></div></section></main>;
}
