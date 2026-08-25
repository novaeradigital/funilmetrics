"use client";

import {useMemo,useRef,useState} from "react";
import {GridLayout,useContainerWidth,type Layout} from "react-grid-layout";
import {Area,AreaChart,Bar,BarChart,CartesianGrid,Cell,Legend,Line,LineChart,
 Pie,PieChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {duplicateDashboardWidget,removeDashboardWidget,saveDashboardLayout,updateDashboardWidget} from "./actions";

export type EditableWidget={
 id:string;widget_type:string;title:string;metric_key:string|null;
 grid_x:number;grid_y:number;grid_width:number;grid_height:number;display_order:number;
 value:string;available:boolean;metric_label:string|null;rule_version:string|null;description:string|null;
 series:{date:string;value:number}[];
};

const metricOptions=[
 ["gross_revenue","Receita bruta"],["net_revenue","Receita líquida"],
 ["approved_payments","Pagamentos aprovados"],["reversed_payments","Pagamentos revertidos"],
 ["meta_spend","Investimento Meta"],["meta_impressions","Impressões Meta"],["meta_clicks","Cliques Meta"],
] as const;
const violet="#8b5cf6",violetSoft="#b58cff",green="#33d17a";

function WidgetChart({widget}:{widget:EditableWidget}){
 if(!widget.available)return <div className="widget-data-state"><strong>Dado indisponível</strong><span>Verifique a integração e o período selecionado.</span></div>;
 if(widget.widget_type==="kpi"||widget.widget_type==="comparison")return <div className="premium-kpi-value">{widget.value}</div>;
 if(!widget.series.length)return <div className="widget-data-state"><strong>Sem dados no período</strong><span>O valor observado é zero ou não há pontos para os filtros.</span></div>;
 const data=widget.series.map(point=>({...point,label:new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit"}).format(new Date(`${point.date}T12:00:00`))}));
 if(widget.widget_type==="donut")return <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="label" innerRadius="52%" outerRadius="78%" paddingAngle={2}>{data.map((_,i)=><Cell key={i} fill={i%2?violetSoft:violet}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>;
 if(widget.widget_type==="bar")return <ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid stroke="#25283a" vertical={false}/><XAxis dataKey="label" stroke="#8f93a8"/><YAxis stroke="#8f93a8"/><Tooltip/><Bar dataKey="value" name={widget.metric_label??widget.title} fill={violet} radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>;
 if(widget.widget_type==="time_series")return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id={`fill-${widget.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={violet} stopOpacity={.42}/><stop offset="100%" stopColor={violet} stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#25283a" vertical={false}/><XAxis dataKey="label" stroke="#8f93a8"/><YAxis stroke="#8f93a8"/><Tooltip/><Area type="monotone" dataKey="value" name={widget.metric_label??widget.title} stroke={violetSoft} fill={`url(#fill-${widget.id})`} strokeWidth={2}/></AreaChart></ResponsiveContainer>;
 return <ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#25283a" vertical={false}/><XAxis dataKey="label" stroke="#8f93a8"/><YAxis stroke="#8f93a8"/><Tooltip/><Line type="monotone" dataKey="value" stroke={green} strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer>;
}

export function DashboardGridEditor({dashboardId,initialWidgets,canEdit}:{dashboardId:string;initialWidgets:EditableWidget[];canEdit:boolean}){
 const initial=useMemo<Layout>(()=>initialWidgets.map((w,i)=>({i:w.id,x:w.grid_x??0,y:w.grid_y??i*3,w:w.grid_width,h:w.grid_height,minW:2,minH:2,maxW:12,maxH:12})),[initialWidgets]);
 const [layout,setLayout]=useState<Layout>(initial),[history,setHistory]=useState<Layout[]>([]),[future,setFuture]=useState<Layout[]>([]);
 const beforeChange=useRef<Layout>(initial);const {width,containerRef,mounted}=useContainerWidth({initialWidth:1200});
 function commit(next:Layout){setHistory(h=>[...h.slice(-29),beforeChange.current]);setFuture([]);setLayout(next);beforeChange.current=next;}
 function undo(){setHistory(h=>{const previous=h.at(-1);if(!previous)return h;setFuture(f=>[layout,...f]);setLayout(previous);beforeChange.current=previous;return h.slice(0,-1)});}
 function redo(){setFuture(f=>{const next=f[0];if(!next)return f;setHistory(h=>[...h,layout]);setLayout(next);beforeChange.current=next;return f.slice(1)});}
 function move(id:string,direction:-1|1){const ordered=[...layout].sort((a,b)=>a.y-b.y||a.x-b.x),index=ordered.findIndex(x=>x.i===id),target=ordered[index+direction];if(!target)return;const current=ordered[index];if(!current)return;commit(layout.map(item=>item.i===id?{...item,x:target.x,y:target.y}:item.i===target.i?{...item,x:current.x,y:current.y}:item));}
 const serialized=JSON.stringify(layout.map((item,index)=>({id:item.i,displayOrder:index,gridWidth:item.w,gridHeight:item.h,gridX:item.x,gridY:item.y})));
 if(!initialWidgets.length)return <div className="custom-dashboard-empty"><strong>Dashboard vazio</strong><p>Abra “Personalizar layout” e adicione o primeiro widget.</p></div>;
 return <>
  {canEdit?<div className="dashboard-edit-toolbar"><span>Modo personalização</span><button type="button" onClick={undo} disabled={!history.length}>↶ Desfazer</button><button type="button" onClick={redo} disabled={!future.length}>↷ Refazer</button></div>:null}
  <div ref={containerRef} className={`premium-grid-wrap${canEdit?" is-editing":""}`}>
   {mounted?<GridLayout width={width} layout={layout} gridConfig={{cols:12,rowHeight:72,margin:[12,12],containerPadding:[0,0]}} dragConfig={{enabled:canEdit,handle:".widget-drag-handle"}} resizeConfig={{enabled:canEdit}} onDragStart={()=>{beforeChange.current=layout}} onResizeStart={()=>{beforeChange.current=layout}} onDragStop={next=>commit(next)} onResizeStop={next=>commit(next)}>
    {initialWidgets.map(widget=><article key={widget.id} className={`premium-widget type-${widget.widget_type}`}>
     {canEdit?<div className="premium-widget-controls"><button className="widget-drag-handle" type="button" aria-label={`Mover ${widget.title}`}>⠿</button><button type="button" onClick={()=>move(widget.id,-1)} aria-label="Mover para cima">↑</button><button type="button" onClick={()=>move(widget.id,1)} aria-label="Mover para baixo">↓</button><details><summary aria-label={`Configurar ${widget.title}`}>•••</summary><div className="widget-actions-popover"><form action={updateDashboardWidget}><input name="dashboard_id" type="hidden" value={dashboardId}/><input name="widget_id" type="hidden" value={widget.id}/><label>Título<input name="title" defaultValue={widget.title} minLength={2} maxLength={120} required/></label><label>Visualização<select name="widget_type" defaultValue={widget.widget_type}><option value="kpi">Card de métrica</option><option value="time_series">Evolução temporal</option><option value="bar">Barras</option><option value="donut">Rosca</option><option value="table">Tabela</option><option value="comparison">Comparação</option></select></label><label>Métrica<select name="metric_key" defaultValue={widget.metric_key??""}>{metricOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button type="submit">Salvar e atualizar</button></form><div className="widget-secondary-actions"><form action={duplicateDashboardWidget}><input name="dashboard_id" type="hidden" value={dashboardId}/><input name="widget_id" type="hidden" value={widget.id}/><button type="submit">Duplicar</button></form><form action={removeDashboardWidget}><input name="dashboard_id" type="hidden" value={dashboardId}/><input name="widget_id" type="hidden" value={widget.id}/><button className="danger" type="submit">Excluir</button></form></div></div></details></div>:null}
     <header className="premium-widget-header"><div><span>{widget.metric_label??widget.widget_type.replaceAll("_"," ")}</span><h3>{widget.title}</h3></div>{widget.rule_version?<button className="metric-info" title={`${widget.description??""} Fonte e regra: ${widget.rule_version}`} aria-label={`Definição de ${widget.title}`}>i</button>:null}</header>
     <div className="premium-widget-body"><WidgetChart widget={widget}/></div>
     {widget.rule_version?<footer>Regra {widget.rule_version} · filtros do dashboard</footer>:null}
    </article>)}
   </GridLayout>:null}
  </div>
  {canEdit?<form action={saveDashboardLayout} className="dashboard-layout-save"><input name="dashboard_id" type="hidden" value={dashboardId}/><input name="layout" type="hidden" value={serialized}/><span>Alterações locais ainda não salvas são descartadas ao cancelar.</span><button type="submit">Salvar layout</button></form>:null}
 </>;
}
