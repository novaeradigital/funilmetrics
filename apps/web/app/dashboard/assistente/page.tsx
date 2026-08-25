import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";import {detectMetricIntent} from "../../../lib/metric-assistant";
import {DashboardSidebar} from "../dashboard-sidebar";
import {DashboardTopbar} from "../dashboard-topbar";
export const dynamic="force-dynamic";
type Metrics={gross:string;net:string;approved:number;reversed:number;orders:number;
 utm_orders:number;campaigns:number;spend:string;impressions:string;clicks:string;currencies:number};
export default async function Page({searchParams}:{searchParams:Promise<{q?:string;period?:string}>}){
 const params=await searchParams,q=(params.q??"").trim().slice(0,300);
 const days=params.period==="7"||params.period==="90"?Number(params.period):30;
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 const db=getDatabase();const metrics=(await db.pool.query<Metrics>(`select
  coalesce((select sum(financial_effect) filter(where financial_effect>0) from public.normalized_payment_events
    where project_id=$1 and data_scope='production' and occurred_at>=now()-($2::integer*interval '1 day')),0)::text gross,
  coalesce((select sum(financial_effect) from public.normalized_payment_events
    where project_id=$1 and data_scope='production' and occurred_at>=now()-($2::integer*interval '1 day')),0)::text net,
  coalesce((select count(distinct payment_id) filter(where financial_effect>0) from public.normalized_payment_events
    where project_id=$1 and data_scope='production' and occurred_at>=now()-($2::integer*interval '1 day')),0)::int approved,
  coalesce((select count(distinct payment_id) filter(where financial_effect<0) from public.normalized_payment_events
    where project_id=$1 and data_scope='production' and occurred_at>=now()-($2::integer*interval '1 day')),0)::int reversed,
  coalesce((select count(*) from public.commerce_orders where project_id=$1 and data_scope='production'
    and created_at>=now()-($2::integer*interval '1 day')),0)::int orders,
  coalesce((select count(distinct order_id) from public.order_attributions where project_id=$1
    and created_at>=now()-($2::integer*interval '1 day') and coalesce(utm_source,src) is not null),0)::int utm_orders,
  coalesce((select count(*) from public.meta_campaigns where project_id=$1),0)::int campaigns,
  coalesce((select sum(spend_base) filter(where conversion_status in ('converted','not_required')) from public.meta_ad_insights_daily where project_id=$1
    and metric_date>=(current_date-(($2::integer-1)*interval '1 day'))::date),0)::text spend,
  coalesce((select sum(impressions) from public.meta_ad_insights_daily where project_id=$1
    and metric_date>=(current_date-(($2::integer-1)*interval '1 day'))::date),0)::text impressions,
  coalesce((select sum(clicks) from public.meta_ad_insights_daily where project_id=$1
    and metric_date>=(current_date-(($2::integer-1)*interval '1 day'))::date),0)::text clicks,
  coalesce((select count(distinct a.currency) from public.meta_ad_insights_daily i join public.meta_ad_accounts a
    on a.id=i.meta_ad_account_id where i.project_id=$1
    and i.metric_date>=(current_date-(($2::integer-1)*interval '1 day'))::date),0)::int currencies`,
  [project.id,days])).rows[0]!;
 const intent=detectMetricIntent(q),money=(v:string)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency}).format(Number(v));
 const response=intent==="revenue"?{title:"Resultado financeiro observado",
  text:`Receita bruta ${money(metrics.gross)} e receita líquida ${money(metrics.net)}, com ${metrics.reversed} pagamento(s) revertido(s).`,
  link:"/dashboard/relatorios"}:intent==="sales"?{title:"Pedidos e pagamentos observados",
  text:`Foram registrados ${metrics.orders} pedido(s) e ${metrics.approved} pagamento(s) aprovado(s). Os números não formam uma coorte de conversão.`,
  link:"/dashboard/vendas"}:intent==="utm_coverage"?{title:"Cobertura de origem registrada",
  text:`${metrics.utm_orders} pedido(s) possuem origem UTM ou src registrada no período. A leitura não é atribuição multitoque calculada.`,
  link:"/dashboard/atribuicao"}:intent==="campaigns"?{title:"Campanhas Meta observadas",
  text:`${metrics.campaigns} campanha(s), ${Number(metrics.impressions).toLocaleString("pt-BR")} impressões e ${Number(metrics.clicks).toLocaleString("pt-BR")} cliques. ${metrics.currencies===1?`Investimento observado ${money(metrics.spend)}.`:"Investimento não somado por haver múltiplas moedas."}`,
  link:"/dashboard/campanhas"}:null;
 const suggestions=[
  {label:"Receita líquida",query:"qual foi a receita líquida?"},
  {label:"Vendas aprovadas",query:"quantas vendas foram aprovadas?"},
  {label:"Cobertura de UTMs",query:"qual a cobertura de UTMs?"},
  {label:"Campanhas Meta",query:"como estão as campanhas Meta?"},
 ];
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/assistente" footerLabel="Respostas com evidências"/>
 <section className="app-content"><DashboardTopbar returnTo="/dashboard/assistente" statusLabel="Consulta governada">
  <nav aria-label="Período da consulta" className="period-filter topbar-period-filter">
   {[7,30,90].map(value=><a className={days===value?"period-active":undefined}
    href={`/dashboard/assistente?period=${value}${q?`&q=${encodeURIComponent(q)}`:""}`} key={value}>{value} dias</a>)}
  </nav>
 </DashboardTopbar><div className="dashboard-main assistant-dashboard">
 <header className="dashboard-titlebar"><div><p className="eyebrow">Inteligência contextual</p><h1>Assistente</h1>
 <p className="dashboard-context">Consultas prontas sobre métricas governadas, com período, limites e evidências visíveis.</p></div></header>
 <section className="assistant-workspace">
  <aside className="assistant-context-panel">
   <div><p className="panel-label">Escopo permitido</p><h2>Consultar operação</h2>
    <p>Receita, vendas, UTMs e campanhas. Sem SQL livre e sem ações externas.</p></div>
   <nav aria-label="Perguntas sugeridas" className="assistant-suggestions">
    {suggestions.map(item=><a className={q===item.query?"assistant-suggestion-active":undefined}
     href={`/dashboard/assistente?period=${days}&q=${encodeURIComponent(item.query)}`} key={item.query}>{item.label}<span>→</span></a>)}
   </nav>
   <div className="assistant-guardrail"><span>Somente leitura</span><small>Regra de métricas v1</small></div>
  </aside>
  <div className="assistant-conversation">
   <section className="dashboard-card assistant-query-card"><form method="get">
    <input name="period" type="hidden" value={days}/>
    <label>Pergunta<div className="assistant-query-row"><input name="q" defaultValue={q} placeholder="Pergunte sobre os dados observados…"/><button>Consultar</button></div></label>
   </form></section>
   {q?<section className="dashboard-card assistant-response-card">{response?<><div className="assistant-response-meta">
    <span>Resposta observada</span><small>regra v1 · últimos {days} dias</small></div><h2>{response.title}</h2>
    <p className="assistant-response-text">{response.text}</p>
    <dl className="assistant-evidence-summary"><div><dt>Período</dt><dd>Últimos {days} dias</dd></div>
     <div><dt>Fuso</dt><dd>{project.timezone}</dd></div><div><dt>Autonomia</dt><dd>Somente leitura</dd></div></dl>
    <Link className="button-link assistant-evidence-link" href={response.link}>Abrir evidências</Link>
   </>:<div className="empty-state"><strong>Pergunta fora do escopo atual</strong>
    <p>Use perguntas sobre receita, vendas, UTMs ou campanhas. O assistente não inventa consultas nem conclusões.</p></div>}</section>:
   <section className="dashboard-card assistant-empty-conversation"><span>✦</span><h2>Escolha uma pergunta ou escreva a sua</h2>
    <p>A resposta aparecerá aqui acompanhada do recorte consultado e do caminho para os dados de origem.</p></section>}
  </div>
 </section>
 </div></section></main>;
}
