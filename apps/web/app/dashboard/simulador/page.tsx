import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";
import {signOut} from "../actions";
import {getActiveProject} from "../../../lib/active-project";
import {ProjectSwitcher} from "../project-switcher";
import {DashboardSidebar} from "../dashboard-sidebar";

export const dynamic="force-dynamic";

type Params={budget?:string;days?:string;cpm?:string;ctr?:string;cvr?:string;ticket?:string;margin?:string};
function number(value:string|undefined){return value===undefined?null:Number(value.replace(",","."));}

export default async function BudgetSimulator({searchParams}:{searchParams:Promise<Params>}){
  const params=await searchParams;
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user) redirect("/login");
  const {project}=await getActiveProject(data.user.id);
  if(!project)redirect("/dashboard/projetos");
  const values={
    budget:number(params.budget),days:number(params.days),cpm:number(params.cpm),
    ctr:number(params.ctr),cvr:number(params.cvr),ticket:number(params.ticket),
    margin:number(params.margin),
  };
  const supplied=Object.values(params).some((value)=>value!==undefined);
  const valid=Object.values(values).every((value)=>value!==null&&Number.isFinite(value)) &&
    values.budget!>0&&values.days!>=1&&values.days!<=365&&values.cpm!>0&&
    values.ctr!>=0&&values.ctr!<=100&&values.cvr!>=0&&values.cvr!<=100&&
    values.ticket!>=0&&values.margin!>0&&values.margin!<=100;
  const result=valid?(()=>{
    const spend=values.budget!*values.days!;
    const impressions=spend/values.cpm!*1000;
    const clicks=impressions*values.ctr!/100;
    const conversions=clicks*values.cvr!/100;
    const revenue=conversions*values.ticket!;
    return {spend,impressions,clicks,conversions,revenue,
      cpa:conversions>0?spend/conversions:null,
      roas:spend>0?revenue/spend:null,
      contribution:revenue*values.margin!/100-spend,
      breakevenRoas:100/values.margin!};
  })():null;
  const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:project?.currency??"BRL"});
  const decimal=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2});
  return <main className="app-layout">
    <DashboardSidebar activeHref="/dashboard/simulador" footerLabel="Sem alteração externa"/>
    <section className="app-content">
      <header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/simulador"/><form action={signOut}><button className="icon-button">Sair</button></form></header>
      <div className="dashboard-main">
        <header className="dashboard-titlebar"><div><p className="eyebrow">Cenário matemático</p><h1>Simulação de orçamento</h1><p className="dashboard-context">Transforme premissas em um cenário comparável. O resultado não é previsão nem recomendação automática.</p></div></header>
        {supplied&&!valid?<div className="notice notice-error">Revise os valores: dias entre 1 e 365, CPM e orçamento positivos e taxas entre 0% e 100%.</div>:null}
        <section className="dashboard-panel">
          <div className="panel-heading"><div><p className="panel-label">Premissas</p><h2>Dados do cenário</h2></div></div>
          <form className="integration-config-grid" method="get">
            <label>Orçamento diário (R$)<input defaultValue={params.budget??""} min="0.01" name="budget" required step="0.01" type="number"/></label>
            <label>Duração (dias)<input defaultValue={params.days??"30"} max="365" min="1" name="days" required type="number"/></label>
            <label>CPM esperado (R$)<input defaultValue={params.cpm??""} min="0.01" name="cpm" required step="0.01" type="number"/></label>
            <label>CTR esperado (%)<input defaultValue={params.ctr??""} max="100" min="0" name="ctr" required step="0.01" type="number"/></label>
            <label>Conversão pós-clique (%)<input defaultValue={params.cvr??""} max="100" min="0" name="cvr" required step="0.01" type="number"/></label>
            <label>Ticket médio (R$)<input defaultValue={params.ticket??""} min="0" name="ticket" required step="0.01" type="number"/></label>
            <label>Margem de contribuição (%)<input defaultValue={params.margin??""} max="100" min="0.01" name="margin" required step="0.01" type="number"/></label>
            <button type="submit">Calcular cenário</button>
          </form>
        </section>
        {result?<><section className="quality-summary">
          <article className="kpi-card kpi-primary"><p>Investimento</p><strong>{money.format(result.spend)}</strong><small>{values.days} dias</small></article>
          <article className="kpi-card"><p>Conversões estimadas</p><strong>{decimal.format(result.conversions)}</strong><small>{decimal.format(result.clicks)} cliques</small></article>
          <article className="kpi-card"><p>CPA matemático</p><strong>{result.cpa===null?"—":money.format(result.cpa)}</strong><small>Investimento ÷ conversões</small></article>
          <article className="kpi-card"><p>ROAS matemático</p><strong>{result.roas===null?"—":`${decimal.format(result.roas)}×`}</strong><small>Equilíbrio: {decimal.format(result.breakevenRoas)}×</small></article>
        </section><section className="dashboard-panel">
          <div className="table-shell"><table><thead><tr><th>Impressões</th><th>Cliques</th><th>Receita</th><th>Contribuição após mídia</th></tr></thead>
          <tbody><tr><td>{decimal.format(result.impressions)}</td><td>{decimal.format(result.clicks)}</td><td>{money.format(result.revenue)}</td><td>{money.format(result.contribution)}</td></tr></tbody></table></div>
        </section></>:<div className="empty-state"><strong>Nenhum cenário calculado</strong><p>Preencha premissas documentadas para obter a simulação.</p></div>}
        <div className="method-note"><strong>Fórmula e limite</strong><p>Impressões = investimento ÷ CPM × 1.000; cliques = impressões × CTR; conversões = cliques × conversão; receita = conversões × ticket. Não há leitura nem escrita na Meta Ads.</p></div>
      </div>
    </section>
  </main>;
}
