"use client";

import Link from "next/link";
import {useEffect,useRef,useState,useTransition} from "react";
import {selectProject} from "./projetos/actions";

type ProjectOption={id:string;name:string;organizationName:string;organizationId:string;slug:string};

export function ProjectSelector({projects,activeProjectId,returnTo,collapsed}:{
 projects:ProjectOption[];activeProjectId:string|null;returnTo:string;collapsed:boolean;
}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[pending,startTransition]=useTransition();
 const container=useRef<HTMLDivElement>(null);
 const current=projects.find(item=>item.id===activeProjectId)??null;
 const multiOrg=new Set(projects.map(item=>item.organizationId)).size>1;
 const filtered=projects.filter(item=>`${item.name} ${item.organizationName}`.toLocaleLowerCase("pt-BR")
  .includes(query.toLocaleLowerCase("pt-BR")));
 useEffect(()=>{
  if(!open)return;
  const close=(event:MouseEvent)=>{if(!container.current?.contains(event.target as Node))setOpen(false)};
  const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};
  document.addEventListener("mousedown",close);document.addEventListener("keydown",escape);
  return()=>{document.removeEventListener("mousedown",close);document.removeEventListener("keydown",escape)};
 },[open]);
 function choose(projectId:string){
  const data=new FormData();data.set("project_id",projectId);
  data.set("return_to",`${window.location.pathname}${window.location.search}`);
  setOpen(false);startTransition(()=>selectProject(data));
 }
 if(!projects.length)return <div className="sidebar-project-empty"><span aria-hidden="true">◇</span>
  {!collapsed?<span><strong>Sem projeto</strong><Link href="/dashboard/projetos">Criar ou solicitar acesso</Link></span>:null}</div>;
 return <div className={`sidebar-project-selector${pending?" is-loading":""}`} ref={container}>
  <button aria-expanded={open} aria-haspopup="listbox" className="project-selector-trigger"
   disabled={pending} onClick={()=>setOpen(value=>!value)} title={current?.name??"Selecionar projeto"} type="button">
   <span className="project-avatar">{current?.name.slice(0,1).toUpperCase()??"?"}</span>
   {!collapsed?<span className="project-selector-copy"><small>Projeto atual</small>
    <strong>{pending?"Trocando projeto…":current?.name??"Seleção inválida"}</strong></span>:null}
   {!collapsed?<span aria-hidden="true" className="project-selector-chevron">⌄</span>:null}
  </button>
  {open&&!collapsed?<div className="project-selector-popover">
   {projects.length>5?<label><span className="sr-only">Buscar projeto</span><input autoFocus
    onChange={event=>setQuery(event.target.value)} placeholder="Buscar projeto…" value={query}/></label>:null}
   <div aria-label="Projetos permitidos" className="project-options" role="listbox">
    {filtered.map(item=><button aria-selected={item.id===activeProjectId} key={item.id}
     onClick={()=>choose(item.id)} role="option" type="button"><span className="project-avatar">
      {item.name.slice(0,1).toUpperCase()}</span><span><strong>{item.name}</strong>
      {multiOrg?<small>{item.organizationName}</small>:null}</span>{item.id===activeProjectId?<i>✓</i>:null}</button>)}
    {!filtered.length?<p>Nenhum projeto encontrado.</p>:null}
   </div><Link href="/dashboard/projetos" onClick={()=>setOpen(false)}>Gerenciar projetos</Link>
  </div>:null}
  <input name="return_to" type="hidden" value={returnTo}/>
 </div>;
}
