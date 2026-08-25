import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";
import {signOut} from "../actions";
import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";
type ScoreRow={id:string;display_name:string|null;identifier:string|null;approved_orders:number;
  net_revenue:string;last_purchase_at:string;reversals:number;recency_points:number;
  frequency_points:number;value_points:number;quality_points:number;score:number};
function mask(value:string|null){
  if(!value)return "Identificador indisponível";
  if(value.includes("@")){const [name,domain]=value.split("@");return `${name?.slice(0,2)}•••@${domain}`;}
  const digits=value.replace(/\D/g,"");return digits.length>4?`•••• ${digits.slice(-4)}`:"Identificador protegido";
}
function band(score:number){return score>=70?"Prioridade alta":score>=40?"Prioridade média":"Prioridade baixa";}

export default async function ScoringPage(){
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  const database=getDatabase();
  const active=await getActiveProject(data.user.id);
  const scope=active.project?{project_id:active.project.id,project_name:active.project.name,
    currency:active.project.currency}:null;
  if(!scope)redirect("/dashboard");
  const rows=(await database.pool.query<ScoreRow>(
    `with orders as (
      select person_id,count(distinct id) filter(where status='approved')::int approved_orders,
       max(occurred_at) filter(where status='approved') last_purchase_at
      from public.commerce_orders where project_id=$1 and data_scope='production'
       and person_id is not null group by person_id),
     finance as (
      select orders.person_id,coalesce(sum(event.financial_effect),0) net_revenue,
       count(distinct event.payment_id) filter(where event.financial_effect<0)::int reversals
      from public.normalized_payment_events event join public.commerce_orders orders on orders.id=event.order_id
      where event.project_id=$1 and event.data_scope='production' and orders.person_id is not null
      group by orders.person_id),
     facts as (
      select person.id,person.display_name,identifier.normalized_value identifier,
       orders.approved_orders,orders.last_purchase_at,coalesce(finance.net_revenue,0) net_revenue,
       coalesce(finance.reversals,0) reversals
      from public.people person join orders on orders.person_id=person.id
      left join finance on finance.person_id=person.id
      left join lateral(select normalized_value from public.person_identifiers candidate
       where candidate.person_id=person.id and candidate.type in('email','phone')
       order by case when candidate.type='email' then 0 else 1 end,candidate.created_at limit 1) identifier on true
      where person.project_id=$1 and person.data_scope='production' and orders.approved_orders>0),
     scored as (
      select facts.*,
       case when last_purchase_at>=now()-interval '30 days' then 30
        when last_purchase_at>=now()-interval '90 days' then 20
        when last_purchase_at>=now()-interval '180 days' then 10 else 0 end recency_points,
       least(approved_orders*10,30)::int frequency_points,
       round(percent_rank() over(order by net_revenue)*30)::int value_points,
       case when reversals=0 then 10 else 0 end quality_points
      from facts)
     select *,recency_points+frequency_points+value_points+quality_points score
     from scored order by score desc,last_purchase_at desc limit 200`,[scope.project_id])).rows;
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:scope.currency||"BRL"});
  const date=new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeZone:"America/Sao_Paulo"});
  const high=rows.filter((row)=>row.score>=70).length;
  const medium=rows.filter((row)=>row.score>=40&&row.score<70).length;
  const low=rows.length-high-medium;
  return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/scoring" footerLabel="Regra explicável v1"/>
    <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/scoring"/><form action={signOut}><button className="icon-button">Sair</button></form></header>
    <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Priorização transparente</p><h1>Lead scoring explicável</h1><p className="dashboard-context">Pontuação operacional baseada no histórico observado. Não estima probabilidade de compra.</p></div></header>
    <section className="alert-summary"><article><span className="alert-dot protected-dot"/><p><strong>{high}</strong><small>prioridade alta</small></p></article><article><span className="alert-dot warning-dot"/><p><strong>{medium}</strong><small>prioridade média</small></p></article><article><span className="alert-dot info-dot"/><p><strong>{low}</strong><small>prioridade baixa</small></p></article><article><span className="alert-dot protected-dot"/><p><strong>{rows.length}</strong><small>compradores avaliados</small></p></article></section>
    <section className="dashboard-panel"><div className="panel-heading"><div><p className="panel-label">Composição de 0 a 100</p><h2>Pessoas priorizadas</h2></div></div>
      {rows.length?<div className="table-shell"><table><thead><tr><th>Pessoa</th><th>Score</th><th>Recência</th><th>Frequência</th><th>Valor relativo</th><th>Qualidade</th><th>Receita líquida</th><th>Última compra</th></tr></thead>
      <tbody>{rows.map((row)=><tr key={row.id}><td><Link href={`/dashboard/clientes/${row.id}`}><strong>{row.display_name??"Cliente sem nome"}</strong><small>{mask(row.identifier)}</small></Link></td><td><strong>{row.score}</strong><small>{band(row.score)}</small></td><td>{row.recency_points}/30</td><td>{row.frequency_points}/30<small>{row.approved_orders} compras</small></td><td>{row.value_points}/30</td><td>{row.quality_points}/10<small>{row.reversals} reversões</small></td><td>{money.format(Number(row.net_revenue))}</td><td>{date.format(new Date(row.last_purchase_at))}</td></tr>)}</tbody></table></div>
      :<div className="empty-state"><strong>Sem compradores para pontuar</strong><p>O score será calculado quando existirem compras aprovadas de produção.</p></div>}
    </section><div className="method-note"><strong>Regra v1</strong><p>Recência vale até 30 pontos; frequência, 10 pontos por compra até 30; valor líquido ocupa posição relativa até 30; ausência de reversão soma 10. Pessoas podem mudar de faixa a cada atualização dos dados.</p></div>
    </div></section></main>;
}
