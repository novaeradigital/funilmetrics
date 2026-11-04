import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
import {TrackingTabs} from "./tabs";
export const dynamic="force-dynamic";
const periods={"7":7,"30":30,"90":90} as const;
type Summary={events:number;visitors:number;sessions:number;bots:number;page_views:number;
 video_plays:number;progress_25:number;progress_50:number;progress_75:number;
 video_complete:number;cta_clicks:number;form_submits:number};
type Conversion={orders:number;net_revenue:string};
type PageRow={page_url:string;views:number;visitors:number;plays:number;completes:number;ctas:number};
type Daily={day:string;visitors:number;events:number;plays:number;completes:number};
export default async function Page({searchParams}:{searchParams:Promise<{period?:string;source?:string}>}){
 const params=await searchParams,periodKey=params.period&&params.period in periods?params.period as keyof typeof periods:"30";
 const days=periods[periodKey],source=/^[0-9a-f-]{36}$/i.test(params.source??"")?params.source!:"";
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");const db=getDatabase();
 const values=[project.id,days,source];
 const summary=(await db.pool.query<Summary>(`select count(*) filter(where not is_bot)::int events,
  count(distinct visitor_id) filter(where not is_bot and visitor_id is not null)::int visitors,
  count(distinct session_id) filter(where not is_bot and session_id is not null)::int sessions,
  count(*) filter(where is_bot)::int bots,
  count(*) filter(where not is_bot and event_type='page_view')::int page_views,
  count(distinct coalesce(visitor_id,session_id,external_event_id))
    filter(where not is_bot and event_type='video_play')::int video_plays,
  count(distinct coalesce(visitor_id,session_id,external_event_id))
    filter(where not is_bot and event_type='video_progress_25')::int progress_25,
  count(distinct coalesce(visitor_id,session_id,external_event_id))
    filter(where not is_bot and event_type='video_progress_50')::int progress_50,
  count(distinct coalesce(visitor_id,session_id,external_event_id))
    filter(where not is_bot and event_type='video_progress_75')::int progress_75,
  count(distinct coalesce(visitor_id,session_id,external_event_id))
    filter(where not is_bot and event_type='video_complete')::int video_complete,
  count(*) filter(where not is_bot and event_type='cta_click')::int cta_clicks,
  count(*) filter(where not is_bot and event_type='form_submit')::int form_submits
  from public.tracking_events where project_id=$1 and occurred_at>=now()-($2*interval '1 day')
  and ($3='' or tracking_source_id::text=$3)`,values)).rows[0]!;
 const pages=(await db.pool.query<PageRow>(`select page_url,count(*) filter(where event_type='page_view')::int views,
  count(distinct visitor_id) filter(where visitor_id is not null)::int visitors,
  count(*) filter(where event_type='video_play')::int plays,
  count(*) filter(where event_type='video_complete')::int completes,
  count(*) filter(where event_type='cta_click')::int ctas from public.tracking_events
  where project_id=$1 and not is_bot and occurred_at>=now()-($2*interval '1 day')
  and ($3='' or tracking_source_id::text=$3) group by page_url order by views desc limit 25`,values)).rows;
 const daily=(await db.pool.query<Daily>(`select occurred_at::date::text as "day",
  count(distinct visitor_id) filter(where visitor_id is not null)::int visitors,count(*)::int events,
  count(*) filter(where event_type='video_play')::int plays,
  count(*) filter(where event_type='video_complete')::int completes from public.tracking_events
  where project_id=$1 and not is_bot and occurred_at>=now()-($2*interval '1 day')
  and ($3='' or tracking_source_id::text=$3) group by occurred_at::date order by occurred_at::date`,values)).rows;
 const sources=(await db.pool.query<{id:string;name:string}>(`select id,name from public.tracking_sources
  where project_id=$1 order by name`,[project.id])).rows;
 const conversion=(await db.pool.query<Conversion>(`select count(distinct conversion.order_id)::int orders,
  coalesce(sum(payment.financial_effect),0)::text net_revenue
  from public.tracking_conversions conversion
  left join public.normalized_payment_events payment on payment.order_id=conversion.order_id
   and payment.data_scope='production'
  where conversion.project_id=$1 and conversion.first_observed_at>=now()-($2*interval '1 day')
  and ($3='' or conversion.tracking_source_id::text=$3)`,values)).rows[0]!;
 const rate=(value:number)=>summary.video_plays?`${(value/summary.video_plays*100).toFixed(1)}%`:"—";
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/tracking" footerLabel="Tracking próprio"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/tracking" statusLabel="Tracking próprio"/><div className="dashboard-main"><TrackingTabs active="overview" />
 <header className="dashboard-titlebar"><div><p className="eyebrow">Tracking próprio · regra v1</p><h1>Rastreamento</h1>
 <p className="dashboard-context">Comportamento observado nas fontes do projeto. Bots ficam fora dos indicadores principais.</p></div>
 <form className="inline-filter-form"><label>Fonte<select name="source" defaultValue={source}><option value="">Todas</option>{sources.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
 <label>Período<select name="period" defaultValue={periodKey}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label><button>Aplicar</button></form></header>
 <section className="kpi-grid"><article><span>Visitantes</span><strong>{summary.visitors}</strong><small>{summary.sessions} sessões</small></article>
 <article><span>Visualizações</span><strong>{summary.page_views}</strong><small>{summary.events} eventos válidos</small></article>
 <article><span>Reproduções</span><strong>{summary.video_plays}</strong></article>
 <article><span>Conclusões</span><strong>{summary.video_complete}</strong><small>{rate(summary.video_complete)} dos visitantes que reproduziram</small></article>
 <article><span>CTAs</span><strong>{summary.cta_clicks}</strong><small>{summary.form_submits} formulários enviados</small></article></section>
 <section className="kpi-grid"><article><span>Pedidos ligados</span><strong>{conversion.orders}</strong>
 <small>Somente quando o destino aceitou o sck próprio</small></article>
 <article><span>Receita líquida ligada</span><strong>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency}).format(Number(conversion.net_revenue))}</strong>
 <small>Observada, sem alegação de causalidade</small></article></section>
 <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Retenção observada</p><h2>Progresso do vídeo</h2></div></div>
 <div className="kpi-grid"><article><span>Iniciou</span><strong>{summary.video_plays}</strong><small>100% da base</small></article>
 <article><span>25%</span><strong>{summary.progress_25}</strong><small>{rate(summary.progress_25)}</small></article>
 <article><span>50%</span><strong>{summary.progress_50}</strong><small>{rate(summary.progress_50)}</small></article>
 <article><span>75%</span><strong>{summary.progress_75}</strong><small>{rate(summary.progress_75)}</small></article>
 <article><span>Concluiu</span><strong>{summary.video_complete}</strong><small>{rate(summary.video_complete)}</small></article></div></section>
 <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Conteúdo</p><h2>Desempenho por página</h2></div><span>{pages.length} página(s)</span></div>
 {pages.length?<div className="table-shell"><table><thead><tr><th>Página</th><th>Views</th><th>Visitantes</th><th>Plays</th><th>Conclusões</th><th>CTAs</th></tr></thead>
 <tbody>{pages.map(p=><tr key={p.page_url}><td><strong>{p.page_url}</strong></td><td>{p.views}</td><td>{p.visitors}</td><td>{p.plays}</td><td>{p.completes}</td><td>{p.ctas}</td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>Nenhum evento recebido</strong><p>Instale a tag em uma origem autorizada e acesse a página para iniciar a coleta.</p></div>}</section>
 <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Série diária</p><h2>Atividade coletada</h2></div><span>{summary.bots} evento(s) de bot excluídos</span></div>
 {daily.length?<div className="table-shell"><table><thead><tr><th>Dia</th><th>Visitantes</th><th>Eventos</th><th>Plays</th><th>Conclusões</th></tr></thead><tbody>{daily.map(d=><tr key={d.day}><td>{new Intl.DateTimeFormat("pt-BR",{timeZone:"UTC"}).format(new Date(`${d.day}T00:00:00Z`))}</td><td>{d.visitors}</td><td>{d.events}</td><td>{d.plays}</td><td>{d.completes}</td></tr>)}</tbody></table></div>:null}</section>
 <div className="method-note"><strong>Limitação</strong><p>Retenção divide visitantes identificados em cada marco pelos visitantes que reproduziram. Eventos sem identificador usam o ID do próprio evento e podem superestimar pessoas.</p></div>
 </div></section></main>;
}
