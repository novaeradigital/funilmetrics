import Link from "next/link";import {redirect} from "next/navigation";
import {createClient} from "../../../../../lib/supabase/server";import {getActiveProject} from "../../../../../lib/active-project";
import {getDatabase} from "../../../../../lib/database";import {ProjectSwitcher} from "../../../project-switcher";
import {DashboardSidebar} from "../../../dashboard-sidebar";
export const dynamic="force-dynamic";
type Row={id:string;scheduled_for:Date;period_days:number;rule_version:string;snapshot:Record<string,unknown>};
const value=(record:Row|undefined,key:string)=>Number(record?.snapshot[key]??0);
const delta=(current:number,base:number)=>({absolute:current-base,relative:base!==0?(current-base)/Math.abs(base):null});
export default async function Page({searchParams}:{searchParams:Promise<{base?:string;current?:string}>}){
 const params=await searchParams,supabase=await createClient(),{data}=await supabase.auth.getUser();
 if(!data.user)redirect("/login");const {project}=await getActiveProject(data.user.id);
 if(!project)redirect("/dashboard/projetos");
 const rows=(await getDatabase().pool.query<Row>(`select id,scheduled_for,period_days,rule_version,snapshot
  from public.report_snapshots where project_id=$1 order by scheduled_for desc limit 100`,[project.id])).rows;
 const valid=(input:string|undefined)=>/^[0-9a-f-]{36}$/i.test(input??"")?input:undefined;
 const base=rows.find(row=>row.id===valid(params.base)),current=rows.find(row=>row.id===valid(params.current));
 const comparable=Boolean(base&&current&&base.id!==current.id&&base.period_days===current.period_days&&
  base.rule_version===current.rule_version);
 const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:project.currency});
 const percent=new Intl.NumberFormat("pt-BR",{style:"percent",maximumFractionDigits:1});
 const metrics=[["Receita bruta","gross_revenue","money"],["Receita líquida","net_revenue","money"],
  ["Pagamentos aprovados","approved_payments","count"],["Pagamentos revertidos","reversed_payments","count"],
  ["Eventos observados","observed_events","count"]] as const;
 return <main className="app-layout"><DashboardSidebar activeHref="/dashboard/relatorios/snapshots/comparar" footerLabel="Comparação auditável"/>
  <section className="app-content"><header className="app-topbar"><ProjectSwitcher returnTo="/dashboard/relatorios/snapshots/comparar"/></header>
  <div className="dashboard-main"><header className="dashboard-titlebar"><div><p className="eyebrow">Leitura descritiva</p>
   <h1>Comparar snapshots</h1><p className="dashboard-context">A comparação usa os valores armazenados e exige a mesma janela e versão de regra.</p></div></header>
  <section className="dashboard-card"><form className="inline-filter-form">
   <label>Base<select name="base" defaultValue={base?.id??""}><option value="">Selecione</option>{rows.map(row=>
    <option value={row.id} key={row.id}>{row.scheduled_for.toLocaleString("pt-BR")} · {row.period_days}d · {row.rule_version}</option>)}</select></label>
   <label>Atual<select name="current" defaultValue={current?.id??""}><option value="">Selecione</option>{rows.map(row=>
    <option value={row.id} key={row.id}>{row.scheduled_for.toLocaleString("pt-BR")} · {row.period_days}d · {row.rule_version}</option>)}</select></label>
   <button type="submit">Comparar</button></form></section>
  {base&&current&&!comparable?<div className="notice notice-error">Escolha snapshots diferentes com a mesma janela e regra.</div>:null}
  {comparable?<section className="dashboard-card"><Link className="export-button"
   href={`/dashboard/relatorios/snapshots/comparar/export?base=${base!.id}&current=${current!.id}`}>Exportar comparação</Link>
   <div className="table-scroll"><table className="sales-table">
   <thead><tr><th>Métrica</th><th>Base</th><th>Atual</th><th>Diferença</th><th>Variação</th></tr></thead>
   <tbody>{metrics.map(([label,key,type])=>{const before=value(base,key),after=value(current,key),change=delta(after,before);
    const format=(number:number)=>type==="money"?money.format(number):number.toLocaleString("pt-BR");
    return <tr key={key}><td><strong>{label}</strong></td><td>{format(before)}</td><td>{format(after)}</td>
     <td>{change.absolute>0?"+":""}{format(change.absolute)}</td>
     <td>{change.relative===null?"Base igual a zero":`${change.relative>0?"+":""}${percent.format(change.relative)}`}</td></tr>})}</tbody>
   </table></div></section>:rows.length<2?<div className="compact-empty">São necessários pelo menos dois snapshots para comparar.</div>:null}
  <div className="method-note"><strong>Sem inferência causal</strong><p>Diferenças podem refletir datas, volume e contexto operacional. A tela não atribui a mudança a campanha, criativo ou ação específica.</p></div>
  </div></section></main>;
}
