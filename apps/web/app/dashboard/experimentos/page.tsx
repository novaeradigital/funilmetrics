import {redirect} from "next/navigation";
import {createClient} from "../../../lib/supabase/server";import {getDatabase} from "../../../lib/database";
import {getActiveProject} from "../../../lib/active-project";import {ProjectSwitcher} from "../project-switcher";
import {signOut} from "../actions";import {createExperiment,updateExperimentStatus} from "./actions";
import {wilsonInterval} from "../../../lib/experiment-statistics";
import {DashboardSidebar} from "../dashboard-sidebar";
export const dynamic="force-dynamic";
type Experiment={id:string;name:string;slug:string;status:string;exposures:number;bots:number};
type Variant={id:string;experiment_id:string;name:string;destination_url:string;
  weight:number;exposures:number;orders:number;converted_visitors:number;net_revenue:string};
type Domain={hostname:string};
export default async function Page({searchParams}:{searchParams:Promise<{status?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");const database=getDatabase();
 const [experimentResult,variantResult,domainResult]=await Promise.all([
  database.pool.query<Experiment>(`select experiment.id,experiment.name,experiment.slug,
    experiment.status::text,count(exposure.id) filter(where not exposure.is_bot)::int exposures,
    count(exposure.id) filter(where exposure.is_bot)::int bots
   from public.experiments experiment left join public.experiment_exposures exposure
    on exposure.experiment_id=experiment.id where experiment.project_id=$1
   group by experiment.id order by experiment.created_at desc`,[project.id]),
  database.pool.query<Variant>(`select variant.id,variant.experiment_id,variant.name,
    variant.destination_url,variant.weight,
    (select count(*)::int from public.experiment_exposures exposure
      where exposure.variant_id=variant.id and not exposure.is_bot) exposures,
    (select count(*)::int from public.experiment_conversions conversion
      join public.experiment_exposures exposure on exposure.id=conversion.exposure_id
      where conversion.variant_id=variant.id and not exposure.is_bot) orders,
    (select count(distinct conversion.exposure_id)::int
      from public.experiment_conversions conversion
      join public.experiment_exposures exposure on exposure.id=conversion.exposure_id
      where conversion.variant_id=variant.id and not exposure.is_bot) converted_visitors,
    (select coalesce(sum(event.financial_effect),0)::text
      from public.experiment_conversions conversion
      join public.experiment_exposures exposure on exposure.id=conversion.exposure_id
      join public.normalized_payment_events event on event.order_id=conversion.order_id
      where conversion.variant_id=variant.id and not exposure.is_bot
        and event.data_scope='production') net_revenue
   from public.experiment_variants variant where variant.project_id=$1
   order by variant.position`,[project.id]),
  database.pool.query<Domain>(`select hostname from public.custom_domains
   where project_id=$1 and status='active' order by hostname`,[project.id]),
 ]);
 const rows=experimentResult.rows,variants=variantResult.rows,domains=domainResult.rows;
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/experimentos" footerLabel="Experimentação controlada"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/experimentos"/>
   <form action={signOut}><button className="icon-button">Sair</button></form></header><div className="dashboard-main">
   {["created","status-updated"].includes(params.status??"")?<div className="notice notice-success">
    {params.status==="created"?"Link inteligente criado e ativo.":"Estado atualizado e auditado."}</div>:null}
   {params.status&&!["created","status-updated"].includes(params.status)?<div className="notice notice-error">
    Não foi possível concluir a ação. Confira dados, slug e permissão.</div>:null}
   <header className="dashboard-titlebar"><div><p className="eyebrow">Experimentação segura</p><h1>Links inteligentes</h1>
    <p className="dashboard-context">Split persistente no domínio padrão, com UTMs preservadas e bots separados.</p></div></header>
   <section className="analytics-grid"><article className="dashboard-card invite-card"><header className="card-header"><div><p className="panel-label">Novo teste</p><h2>Duas variantes</h2></div></header>
    <form action={createExperiment}><label>Nome<input name="name" required/></label><label>Slug<input name="slug" pattern="[a-z0-9-]{3,60}" required/></label>
     <label>Destino A<input name="destination_a" type="url" placeholder="https://..." required/></label>
     <label>Destino B<input name="destination_b" type="url" placeholder="https://..." required/></label>
     <label>Peso A (%)<input name="weight_a" type="number" min="1" max="99" defaultValue="50" required/></label>
     <button type="submit">Criar e ativar</button><small>O peso B é calculado automaticamente. Nenhum vencedor será escolhido automaticamente.</small></form>
   </article><article className="dashboard-card members-card"><header className="card-header"><div><p className="panel-label">Projeto atual</p><h2>Experimentos</h2></div></header>
    {rows.length?<div className="members-list">{rows.map(row=>{
      const items=variants.filter(item=>item.experiment_id===row.id);
      return <div className="member-row" key={row.id}><p><strong>{row.name}</strong><small>/r/{row.slug}</small>
       {domains.map(domain=><small key={domain.hostname}>https://{domain.hostname}/r/{row.slug}</small>)}</p>
       <span className="member-role">{row.status}</span><strong>{row.exposures} exposições</strong><small>{row.bots} bots</small>
       <details className="member-actions"><summary>Distribuição e controle</summary>
        <div className="project-scope-list">{items.map(item=>{
          const observed=row.exposures?item.exposures/row.exposures*100:0;
          const conversionRate=item.exposures?item.converted_visitors/item.exposures:0;
          const interval=wilsonInterval(item.converted_visitors,item.exposures);
          return <p key={item.id}><strong>Variante {item.name}</strong>
           <small>Esperado {item.weight}% · observado {observed.toLocaleString("pt-BR",{maximumFractionDigits:1})}% ({item.exposures})</small>
           <small>{item.converted_visitors} visitante(s) com pedido · taxa observada {
             (conversionRate*100).toLocaleString("pt-BR",{maximumFractionDigits:2})}%</small>
           <small>Intervalo 95%: {(interval.lower*100).toLocaleString("pt-BR",{maximumFractionDigits:2})}%–{
             (interval.upper*100).toLocaleString("pt-BR",{maximumFractionDigits:2})}% · {item.orders} pedido(s)</small>
           <small>Receita líquida observada: {
             new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency})
               .format(Number(item.net_revenue))}</small>
           <small>{item.destination_url}</small></p>})}</div>
        <p className="member-action-note">{row.exposures<100
          ?"Amostra inicial: não avaliar equilíbrio nem vencedor."
          :"Distribuição descritiva; diferença observada não define vencedor."}</p>
        <form action={updateExperimentStatus}><input type="hidden" name="experiment_id" value={row.id}/>
         <input type="hidden" name="status" value={row.status==="active"?"paused":"active"}/>
         <button type="submit">{row.status==="active"?"Pausar redirecionamento":"Reativar experimento"}</button></form>
       </details></div>})}</div>:<div className="compact-empty">Nenhum link inteligente criado.</div>}</article></section>
   <div className="method-note"><strong>Leitura conservadora</strong><p>A distribuição exclui bots identificados. Pedidos só são ligados quando o link pôde usar um sck próprio sem substituir um valor existente. A ligação observada não declara causalidade nem vencedor.</p></div>
  </div></section></main>;
}
