import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
const segments={
  first_time:{label:"Primeira compra",description:"Uma compra aprovada no histórico, ocorrida no período."},
  repeat:{label:"Recorrentes",description:"Duas ou mais compras aprovadas no histórico."},
  recent:{label:"Ativos em 30 dias",description:"Última compra aprovada nos últimos 30 dias."},
  inactive:{label:"Sem compra há 90 dias",description:"Já comprou, mas a última aprovação ocorreu há mais de 90 dias."},
  reversed:{label:"Com reversão no período",description:"Possui reembolso ou chargeback observado no período."},
} as const;
const periods={"30d":30,"90d":90,"365d":365} as const;
type Row={id:string;display_name:string|null;identifier:string|null;lifetime_approved:number;
  period_approved:number;reversals:number;net_revenue:string;last_purchase_at:string|null};
function mask(value:string|null){
  if(!value)return "Identificador indisponível";
  if(value.includes("@")){const [name,domain]=value.split("@");return `${name?.slice(0,2)}•••@${domain}`;}
  const digits=value.replace(/\D/g,"");return digits.length>4?`•••• ${digits.slice(-4)}`:"Identificador protegido";
}

export default async function SegmentsPage({searchParams}:{searchParams:Promise<{segment?:string;period?:string}>}){
  const params=await searchParams;
  const segment=params.segment&&params.segment in segments?params.segment as keyof typeof segments:"first_time";
  const periodKey=params.period&&params.period in periods?params.period as keyof typeof periods:"90d";
  const days=periods[periodKey];
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const database=getDatabase();
  const active=await getActiveProject(data.user.id);
  const scope=active.project?{project_id:active.project.id,project_name:active.project.name,
    currency:active.project.currency}:null;
  if(!scope)redirect("/dashboard");
  const rows=(await database.pool.query<Row>(
    `with lifetime as (
      select person_id,count(distinct id) filter(where status='approved')::int lifetime_approved,
       max(occurred_at) filter(where status='approved') last_purchase_at
      from public.commerce_orders where project_id=$1 and data_scope='production'
       and person_id is not null group by person_id),
     selected as (
      select person_id,count(distinct id) filter(where status='approved')::int period_approved
      from public.commerce_orders where project_id=$1 and data_scope='production'
       and person_id is not null and occurred_at>=now()-($2*interval '1 day') group by person_id),
     finance as (
      select orders.person_id,coalesce(sum(event.financial_effect),0)::text net_revenue,
       count(distinct event.payment_id) filter(where event.financial_effect<0)::int reversals
      from public.normalized_payment_events event join public.commerce_orders orders on orders.id=event.order_id
      where event.project_id=$1 and event.data_scope='production'
       and event.occurred_at>=now()-($2*interval '1 day') and orders.person_id is not null
      group by orders.person_id)
     select person.id,person.display_name,identifier.normalized_value identifier,
      coalesce(lifetime.lifetime_approved,0) lifetime_approved,
      coalesce(selected.period_approved,0) period_approved,
      coalesce(finance.reversals,0) reversals,coalesce(finance.net_revenue,'0') net_revenue,
      lifetime.last_purchase_at::text
     from public.people person join lifetime on lifetime.person_id=person.id
     left join selected on selected.person_id=person.id left join finance on finance.person_id=person.id
     left join lateral(select normalized_value from public.person_identifiers candidate
      where candidate.person_id=person.id and candidate.type in('email','phone')
      order by case when candidate.type='email' then 0 else 1 end,candidate.created_at limit 1) identifier on true
     where person.project_id=$1 and person.data_scope='production' and (
      ($3='first_time' and lifetime.lifetime_approved=1 and selected.period_approved=1) or
      ($3='repeat' and lifetime.lifetime_approved>=2) or
      ($3='recent' and lifetime.last_purchase_at>=now()-interval '30 days') or
      ($3='inactive' and lifetime.last_purchase_at<now()-interval '90 days') or
      ($3='reversed' and finance.reversals>0))
     order by lifetime.last_purchase_at desc nulls last limit 200`,
    [scope.project_id,days,segment])).rows;
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:scope.currency||"BRL"});
  const date=new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeZone:"America/Sao_Paulo"});
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/segmentos" footerLabel="Sem ativação automática"/>
    <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/segmentos"/><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Regras explicáveis</p><h1>Segmentos</h1><p className="dashboard-context">Listas calculadas sobre a jornada consolidada. Pessoas podem pertencer a mais de um segmento.</p></div>
      <nav className="period-filter">{Object.entries(periods).map(([key,value])=><Link className={key===periodKey?"period-active":undefined} href={`/dashboard/segmentos?segment=${segment}&period=${key}`} key={key}>{value} dias</Link>)}</nav></header>
    <section className="integration-config-grid">{Object.entries(segments).map(([key,item])=><Link className={`integration-config-card ${key===segment?"configured":""}`} href={`/dashboard/segmentos?segment=${key}&period=${periodKey}`} key={key}><p className="panel-label">{item.label}</p><small>{item.description}</small></Link>)}</section>
    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Resultado atual</p><h2>{segments[segment].label}</h2></div><span>{rows.length} pessoa(s)</span></div>
      {rows.length?<div className="table-shell"><table><thead><tr><th>Pessoa</th><th>Compras históricas</th><th>No período</th><th>Reversões</th><th>Receita líquida</th><th>Última compra</th></tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id}><td><Link href={`/dashboard/clientes/${row.id}`}><strong>{row.display_name??"Cliente sem nome"}</strong><small>{mask(row.identifier)}</small></Link></td><td>{row.lifetime_approved}</td><td>{row.period_approved}</td><td>{row.reversals}</td><td>{money.format(Number(row.net_revenue))}</td><td>{row.last_purchase_at?date.format(new Date(row.last_purchase_at)):"—"}</td></tr>)}</tbody></table></div>
      :<div className="empty-state"><strong>Nenhuma pessoa neste segmento</strong><p>A regra foi aplicada, mas não encontrou correspondências no escopo selecionado.</p></div>}
    </section><div className="method-note"><strong>Limites</strong><p>Os segmentos são consultas, não rótulos permanentes. Não enviam dados a plataformas externas, não ativam campanhas e não representam propensão ou causalidade.</p></div>
    </div></section></main>;
}
