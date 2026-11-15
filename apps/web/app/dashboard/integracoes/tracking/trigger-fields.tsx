"use client";
import {useState} from "react";
export type TriggerRule={type:string;value:string;label:string};
const TYPE_OPTIONS=[
 {value:"attribute",label:"Atributo data-fm-evento no elemento"},
 {value:"selector",label:"Seletor CSS"},
 {value:"id",label:"ID do elemento"},
 {value:"url",label:"URL específica"},
 {value:"url_part",label:"Trecho da URL"},
 {value:"domain",label:"Domínio do link (qualquer endereço do domínio)"},
];
export function TriggerFields({initial}:{initial:TriggerRule[]}){
 const [rows,setRows]=useState<TriggerRule[]>(initial.length?initial:[{type:"attribute",value:"",label:""}]);
 const update=(index:number,patch:Partial<TriggerRule>)=>
  setRows(current=>current.map((row,i)=>i===index?{...row,...patch}:row));
 return <fieldset className="trigger-fields"><legend>Gatilhos do InitiateCheckout</legend>
  {rows.map((row,index)=><div className="trigger-row" key={index}>
   <label>Tipo<select name="ic_trigger_type" value={row.type}
    onChange={e=>update(index,{type:e.target.value})}>
    {TYPE_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
   </select></label>
   <label>Valor<input name="ic_trigger_value" value={row.value}
    onChange={e=>update(index,{value:e.target.value})}
    placeholder="Ex.: .btn-comprar, btn-comprar, pay.kiwify.com.br ou /checkout"/></label>
   <label>Rótulo da oferta<input name="ic_trigger_label" value={row.label}
    onChange={e=>update(index,{label:e.target.value})} placeholder="Ex.: Plano anual"/></label>
   {rows.length>1?<button type="button" className="trigger-remove"
    onClick={()=>setRows(current=>current.filter((_,i)=>i!==index))}>Remover</button>:null}
  </div>)}
  <button type="button" className="trigger-add"
   onClick={()=>setRows(current=>[...current,{type:"url",value:"",label:""}])}>+ Adicionar regra</button>
 </fieldset>;
}
