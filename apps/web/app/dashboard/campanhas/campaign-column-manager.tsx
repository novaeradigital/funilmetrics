"use client";

import {ReactNode,useEffect,useMemo,useState} from "react";

const available=[
  ["status","Status"],["structure","Estrutura"],["spend","Investimento"],
  ["impressions","Impressões"],["clicks","Cliques"],["ctr","CTR"],["cpc","CPC"],
] as const;

export function CampaignColumnManager({children,storageKey}:{children:ReactNode;storageKey:string}){
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState("");
  const [visible,setVisible]=useState<string[]>(available.map(([id])=>id));
  useEffect(()=>{
    let animationFrame=0;
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey)??"null");
      if(Array.isArray(saved)&&saved.length)animationFrame=requestAnimationFrame(()=>
        setVisible(saved.filter((id)=>available.some(([key])=>key===id))));
    }catch{/* preferência inválida: usa padrão */}
    return ()=>cancelAnimationFrame(animationFrame);
  },[storageKey]);
  const filtered=useMemo(()=>available.filter(([,label])=>
    label.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))),[search]);
  const save=()=>{localStorage.setItem(storageKey,JSON.stringify(visible));setOpen(false);};
  return <div className={`campaign-columns ${available.filter(([id])=>!visible.includes(id)).map(([id])=>`hide-${id}`).join(" ")}`}>
    <div className="campaign-table-tools">
      <button type="button" onClick={()=>setOpen(true)}>⚙ Personalizar colunas</button>
      <small>{visible.length+1} coluna(s) visível(is)</small>
    </div>
    {children}
    {open?<div className="column-modal-backdrop" role="presentation" onMouseDown={()=>setOpen(false)}>
      <section className="column-modal" role="dialog" aria-modal="true" aria-labelledby="column-modal-title"
        onMouseDown={(event)=>event.stopPropagation()}>
        <header><div><h2 id="column-modal-title">Personalize as colunas</h2>
          <p>Escolha as métricas exibidas na tabela. A preferência fica salva neste navegador.</p></div>
          <button aria-label="Fechar" type="button" onClick={()=>setOpen(false)}>×</button></header>
        <div className="column-modal-body"><div className="column-options">
          <input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar por coluna"/>
          {filtered.map(([id,label])=><label key={id}><input type="checkbox" checked={visible.includes(id)}
            onChange={(event)=>setVisible(current=>event.target.checked?[...current,id]:current.filter(item=>item!==id))}/>
            <span>{label}</span></label>)}
        </div><div className="selected-columns"><strong>Colunas selecionadas</strong>
          <div className="selected-column locked">Campanha <small>fixa</small></div>
          {visible.map((id)=>{const label=available.find(([key])=>key===id)?.[1]??id;return <div className="selected-column" key={id}>
            <span>✓ {label}</span><span className="column-order-actions">
              <button type="button" onClick={()=>setVisible(current=>current.filter(item=>item!==id))}>×</button>
            </span></div>})}
        </div></div>
        <footer><button type="button" className="secondary" onClick={()=>setOpen(false)}>Cancelar</button>
          <button type="button" onClick={save}>Salvar</button></footer>
      </section>
    </div>:null}
  </div>;
}
