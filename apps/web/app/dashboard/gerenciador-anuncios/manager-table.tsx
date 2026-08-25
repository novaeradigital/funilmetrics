"use client";

import {useEffect,useMemo,useState,type PointerEvent as ReactPointerEvent,type ReactNode} from "react";
import Link from "next/link";
import {requestBulkManagerStatusChange,requestManagerEdit,requestManagerStatusChange,saveManagerColumns} from "./actions";

export type ManagerLevel="accounts"|"campaigns"|"adsets"|"ads";
export type ManagerRow={id:string;name:string;status:string|null;parent_name:string|null;account_name:string;
 currency:string|null;budget:string|null;spend:string;impressions:string;reach:string;clicks:string;
 landing_page_views:string;initiate_checkout:string;campaign_id:string|null};

const catalog=[
 ["selection","Seleção","Estrutura"],["status","Status","Estrutura"],["name","Nome","Estrutura"],
 ["parent","Nível superior","Estrutura"],["budget","Orçamento","Entrega"],["spend","Investimento","Desempenho"],
 ["impressions","Impressões","Desempenho"],["clicks","Cliques no link","Desempenho"],
 ["reach","Alcance","Desempenho"],["frequency","Frequência","Desempenho"],["cpm","CPM","Desempenho"],
 ["ctr","CTR no link","Desempenho"],["cpc","CPC no link","Desempenho"],
 ["landing_page_views","Visualizações da página de destino","Conversão"],
 ["cost_per_landing_page_view","Custo por visualização da página","Conversão"],
 ["initiate_checkout","Checkouts iniciados","Conversão"],
 ["cost_per_initiate_checkout","Custo por checkout iniciado","Conversão"],
] as const;
const defaults=["selection","status","name","budget","spend","impressions","clicks","ctr","cpc"];

export function ManagerTable({rows,level,initialColumns,returnTo,projectCurrency,filters,navigation}:{rows:ManagerRow[];level:ManagerLevel;
 initialColumns:string[];returnTo:string;projectCurrency:string;filters:ReactNode;navigation:ReactNode}){
 const [open,setOpen]=useState(false),[bulkOpen,setBulkOpen]=useState(false),[statusRow,setStatusRow]=useState<ManagerRow|null>(null),
  [editRow,setEditRow]=useState<ManagerRow|null>(null),[search,setSearch]=useState("");
 const [columns,setColumns]=useState(initialColumns.length?initialColumns:defaults);
 const [selected,setSelected]=useState<string[]>([]);
 const [columnWidths,setColumnWidths]=useState<Record<string,number>>({});
 const widthStorageKey=`funil-manager-column-widths:${level}`;
 useEffect(()=>{const timer=window.setTimeout(()=>{try{const stored=window.localStorage.getItem(widthStorageKey);
  if(stored)setColumnWidths(JSON.parse(stored) as Record<string,number>);}catch{}},0);return()=>window.clearTimeout(timer);},[widthStorageKey]);
 const visible=(id:string)=>columns.includes(id);
 const filtered=useMemo(()=>catalog.filter(([,label])=>label.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))),[search]);
 const money=(value:number,currency:string|null)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:currency||projectCurrency}).format(value);
 const move=(id:string,direction:-1|1)=>setColumns(current=>{const index=current.indexOf(id),target=index+direction;
  if(index<0||target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target]!,next[index]!];return next;});
 const toggleAll=()=>setSelected(current=>current.length===rows.length?[]:rows.map(row=>row.id));
 const tableColumns=[...(visible("selection")?["selection"]:[]),...columns.filter(id=>id!=="selection"),"edit"];
 const defaultWidth=(id:string)=>id==="selection"?44:id==="status"?72:id==="name"?280:id==="edit"?58:140;
 const tableWidth=tableColumns.reduce((total,id)=>total+(columnWidths[id]??defaultWidth(id)),0);
 const startResize=(event:ReactPointerEvent<HTMLSpanElement>,id:string)=>{event.preventDefault();event.stopPropagation();
  const startX=event.clientX,startWidth=columnWidths[id]??defaultWidth(id),minimum=id==="selection"?40:id==="edit"?52:64;
  const move=(pointerEvent:PointerEvent)=>setColumnWidths(current=>({...current,[id]:Math.max(minimum,startWidth+pointerEvent.clientX-startX)}));
  const stop=()=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",stop);
   setColumnWidths(current=>{try{window.localStorage.setItem(widthStorageKey,JSON.stringify(current));}catch{}return current;});};
  document.addEventListener("pointermove",move);document.addEventListener("pointerup",stop);};
 const drilldownHref=(row:ManagerRow)=>{if(level!=="campaigns"&&level!=="adsets")return null;
  const current=new URL(returnTo,"https://funil-metrics.local");
  current.searchParams.set("level",level==="campaigns"?"adsets":"ads");
  current.searchParams.set(level==="campaigns"?"campaign":"adset",row.id);
  current.searchParams.delete("q");current.searchParams.delete("status");current.searchParams.delete("page");
  return `${current.pathname}?${current.searchParams.toString()}`;};
 const header=(id:string,label:ReactNode)=><th key={id}><span className="manager-column-label">{label}</span>
  <span className="manager-column-resizer" role="separator" aria-label={`Redimensionar coluna ${String(label)}`} aria-orientation="vertical"
   onPointerDown={event=>startResize(event,id)}/></th>;
 return <>
  <div className="manager-filter-toolbar">
   {filters}
   <button type="button" className="manager-columns-button" onClick={()=>setOpen(true)}>⚙ Personalizar colunas</button>
  </div>
  {navigation}
  <div className="campaign-table-tools ads-manager-tools"><div className="manager-selection-summary">
   {selected.length?<strong>{selected.length} selecionado(s)</strong>:<small>Selecione itens para preparar ações em lote</small>}
   {selected.length&&level!=="accounts"?<button type="button" onClick={()=>setBulkOpen(true)}>Ação em lote</button>:null}
  </div><small>{columns.length} coluna(s) visível(is)</small></div>
  <div className="table-shell manager-resizable-table"><table style={{width:`max(100%, ${tableWidth}px)`}}><colgroup>{tableColumns.map(id=><col key={id}
   style={{width:columnWidths[id]??defaultWidth(id)}}/>)}</colgroup><thead><tr>
   {visible("selection")?header("selection",<input aria-label="Selecionar todos" type="checkbox" checked={rows.length>0&&selected.length===rows.length} onChange={toggleAll}/>):null}
   {columns.filter(id=>id!=="selection").map(id=>header(id,catalog.find(([key])=>key===id)?.[1]))}{header("edit","Editar")}
  </tr></thead><tbody>{rows.map(row=>{const spend=Number(row.spend),impressions=Number(row.impressions),reach=Number(row.reach),clicks=Number(row.clicks);
   const landingPageViews=Number(row.landing_page_views),initiateCheckout=Number(row.initiate_checkout);
   const detailHref=drilldownHref(row);
   const active=row.status==="ACTIVE";
   const statusControl=<button type="button" className={`manager-status-toggle ${active?"is-on":""}`}
    aria-label={`${active?"Pausar":"Ativar"} ${row.name}`} aria-pressed={active}
    title={active?"Ativa — clique para solicitar pausa":"Pausada — clique para solicitar ativação"}
    disabled={level==="accounts"} onClick={()=>setStatusRow(row)}><span aria-hidden="true"/></button>;
   const cells:Record<string,ReactNode>={status:statusControl,name:<>{detailHref?<Link href={detailHref}><strong>{row.name}</strong></Link>:<strong>{row.name}</strong>}<small>{row.account_name}</small></>,
    parent:row.parent_name||row.account_name,budget:row.budget?money(Number(row.budget)/100,row.currency):"Conjunto →",
    spend:money(spend,row.currency),impressions:impressions.toLocaleString("pt-BR"),reach:reach.toLocaleString("pt-BR"),clicks:clicks.toLocaleString("pt-BR"),
    frequency:reach?(impressions/reach).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}):"—",
    cpm:impressions?money(spend/impressions*1000,row.currency):"—",
    ctr:impressions?`${(clicks/impressions*100).toFixed(2).replace(".",",")}%`:"—",cpc:clicks?money(spend/clicks,row.currency):"—",
    landing_page_views:landingPageViews.toLocaleString("pt-BR"),cost_per_landing_page_view:landingPageViews?money(spend/landingPageViews,row.currency):"—",
    initiate_checkout:initiateCheckout.toLocaleString("pt-BR"),cost_per_initiate_checkout:initiateCheckout?money(spend/initiateCheckout,row.currency):"—"};
   return <tr key={row.id}>{visible("selection")?<td><input aria-label={`Selecionar ${row.name}`} type="checkbox"
    checked={selected.includes(row.id)} onChange={()=>setSelected(current=>current.includes(row.id)?current.filter(id=>id!==row.id):[...current,row.id])}/></td>:null}
    {columns.filter(id=>id!=="selection").map(id=><td key={id}>{cells[id]??"—"}</td>)}
    <td>{level!=="accounts"?<button type="button" className="manager-edit-button" aria-label={`Editar ${row.name}`}
     title="Editar nome ou orçamento" onClick={()=>setEditRow(row)}><svg aria-hidden="true" viewBox="0 0 24 24"><path
      d="M4 20h4.25L19.4 8.85a2 2 0 0 0 0-2.83L17.98 4.6a2 2 0 0 0-2.83 0L4 15.75V20Zm2-3.42 9.85-9.85 1.42 1.42L7.42 18H6v-1.42Z"/></svg>
     </button>:<span className="muted-text">—</span>}</td></tr>})}</tbody></table></div>
  {open?<div className="column-modal-backdrop" role="presentation" onMouseDown={()=>setOpen(false)}><section className="column-modal" role="dialog" aria-modal="true"
   onMouseDown={event=>event.stopPropagation()}><header><div><h2>Personalize as colunas</h2><p>Escolha e ordene os campos da tabela. A preferência vale para este projeto e nível.</p></div>
   <button type="button" aria-label="Fechar" onClick={()=>setOpen(false)}>×</button></header><div className="column-modal-body"><div className="column-options">
    <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar por coluna"/>
    {filtered.map(([id,label,group])=><label key={id}><input type="checkbox" checked={visible(id)} disabled={id==="name"}
     onChange={event=>setColumns(current=>event.target.checked?[...current,id]:current.filter(value=>value!==id))}/><span>{label}<small>{group}</small></span></label>)}
   </div><div className="selected-columns"><strong>Colunas selecionadas</strong>{columns.map((id,index)=><div className="selected-column" key={id}>
    <span>⋮⋮ {catalog.find(([key])=>key===id)?.[1]}</span><span className="column-order-actions"><button type="button" disabled={index===0} onClick={()=>move(id,-1)}>↑</button>
    <button type="button" disabled={index===columns.length-1} onClick={()=>move(id,1)}>↓</button>{id!=="name"?<button type="button" onClick={()=>setColumns(current=>current.filter(value=>value!==id))}>×</button>:null}</span></div>)}</div></div>
   <form action={saveManagerColumns} className="column-modal-save-form"><input type="hidden" name="level" value={level}/><input type="hidden" name="columns" value={JSON.stringify(columns)}/>
    <input type="hidden" name="return_to" value={returnTo}/><footer><button type="button" className="secondary" onClick={()=>setColumns(defaults)}>Restaurar padrão</button>
    <button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancelar</button><button type="submit">Salvar</button></footer></form></section></div>:null}
  {bulkOpen?<div className="column-modal-backdrop" role="presentation" onMouseDown={()=>setBulkOpen(false)}><section className="column-modal manager-bulk-modal"
   role="dialog" aria-modal="true" onMouseDown={event=>event.stopPropagation()}><header><div><h2>Ação em lote</h2>
    <p>{selected.length} item(ns) serão enviados para aprovação humana.</p></div><button type="button" aria-label="Fechar" onClick={()=>setBulkOpen(false)}>×</button></header>
   <form action={requestBulkManagerStatusChange} className="manager-bulk-form"><input type="hidden" name="entity_type"
    value={level==="campaigns"?"campaign":level==="adsets"?"adset":"ad"}/><input type="hidden" name="entity_ids" value={JSON.stringify(selected)}/>
    <input type="hidden" name="return_to" value={returnTo}/><label>Ação<select name="action_type" required><option value="pause">Pausar</option>
     <option value="activate">Ativar</option></select></label><label>Motivo<textarea name="reason" required minLength={5}
      placeholder="Explique o motivo desta alteração em lote"/></label><div className="notice notice-warning">Nenhuma alteração será enviada à Meta agora. Cada item gerará uma solicitação auditável.</div>
    <footer><button type="button" className="secondary" onClick={()=>setBulkOpen(false)}>Cancelar</button><button type="submit">Enviar para aprovação</button></footer>
   </form></section></div>:null}
   {statusRow?<div className="column-modal-backdrop" role="presentation" onMouseDown={()=>setStatusRow(null)}><section
    className="column-modal manager-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="manager-status-title"
    onMouseDown={event=>event.stopPropagation()}><header><div><h2 id="manager-status-title">
     {statusRow.status==="ACTIVE"?"Pausar":"Ativar"} {statusRow.name}</h2>
     <p>A mudança será registrada e dependerá de aprovação humana antes da execução na Meta.</p></div>
     <button type="button" aria-label="Fechar" onClick={()=>setStatusRow(null)}>×</button></header>
    <form action={requestManagerStatusChange} className="manager-bulk-form"><input type="hidden" name="entity_type"
     value={level==="campaigns"?"campaign":level==="adsets"?"adset":"ad"}/><input type="hidden" name="entity_id" value={statusRow.id}/>
     <input type="hidden" name="action_type" value={statusRow.status==="ACTIVE"?"pause":"activate"}/>
     <input type="hidden" name="return_to" value={returnTo}/><label>Motivo<textarea name="reason" required minLength={5}
      placeholder="Explique o motivo desta alteração"/></label><div className="notice notice-warning">O botão só mudará de posição depois que a solicitação for aprovada, executada e confirmada pela Meta.</div>
     <footer><button type="button" className="secondary" onClick={()=>setStatusRow(null)}>Cancelar</button>
      <button type="submit">Enviar para aprovação</button></footer></form></section></div>:null}
   {editRow?<div className="column-modal-backdrop" role="presentation" onMouseDown={()=>setEditRow(null)}><section className="column-modal manager-bulk-modal"
   role="dialog" aria-modal="true" onMouseDown={event=>event.stopPropagation()}><header><div><h2>Editar {editRow.name}</h2>
    <p>A alteração será registrada e enviada para aprovação humana.</p></div><button type="button" aria-label="Fechar" onClick={()=>setEditRow(null)}>×</button></header>
   <form action={requestManagerEdit} className="manager-bulk-form"><input type="hidden" name="entity_type"
    value={level==="campaigns"?"campaign":level==="adsets"?"adset":"ad"}/><input type="hidden" name="entity_id" value={editRow.id}/>
    <input type="hidden" name="return_to" value={returnTo}/><label>Campo<select name="field" required defaultValue="name">
     <option value="name">Nome</option>{level!=="ads"?<option value="budget">Orçamento diário</option>:null}</select></label>
    <label>Novo nome<input name="name" maxLength={255} defaultValue={editRow.name}/></label>{level!=="ads"?<label>Novo orçamento diário
     <input name="budget" type="number" min="0.01" max="10000000" step="0.01" defaultValue={editRow.budget?Number(editRow.budget)/100:undefined}/></label>:null}
    <label>Motivo<textarea name="reason" required minLength={5} placeholder="Explique o motivo da edição"/></label>
    <div className="notice notice-warning">A aprovação ainda não altera nome ou orçamento na Meta. O executor específico permanece bloqueado.</div>
    <footer><button type="button" className="secondary" onClick={()=>setEditRow(null)}>Cancelar</button><button type="submit">Enviar para aprovação</button></footer>
   </form></section></div>:null}
 </>;
}
