"use client";

import Link from "next/link";
import {useEffect,useMemo,useState} from "react";
import {ProjectSelector} from "./project-selector";

type ProjectOption={id:string;name:string;organizationName:string;organizationId:string;slug:string};
type Props={activeHref:string;footerLabel?:string;projects:ProjectOption[];activeProjectId:string|null};

const navigationGroups=[
 {key:"overview",label:"Visão geral",icon:"overview",items:[
  {href:"/dashboard-v2",label:"Dashboard"},
  {href:"/dashboard/melhores-anuncios",label:"Melhores anúncios"}]},
 {key:"campaigns",label:"Campanhas",icon:"campaigns",items:[
  {href:"/dashboard/gerenciador-anuncios",label:"Gerenciador de anúncios"},
  {href:"/dashboard/campanhas/subir",label:"Subir campanhas"},
  {href:"/dashboard/campanhas/publicacoes",label:"Publicações"}]},
 {key:"tracking",label:"Rastreamento",icon:"funnel",items:[
  {href:"/dashboard/tracking",label:"Visão geral"},
  {href:"/dashboard/integracoes/tracking",label:"Fontes e script"},
  {href:"/dashboard/tracking/pixels",label:"Pixels Meta"},
  {href:"/dashboard/tracking/eventos",label:"Eventos enviados"}]},
 {key:"performance",label:"Performance",icon:"campaigns",items:[
  {href:"/dashboard/vendas",label:"Vendas"},
  {href:"/dashboard/produtos",label:"Produtos"},{href:"/dashboard/atribuicao",label:"Atribuição"},
  {href:"/dashboard/clientes",label:"Clientes"},{href:"/dashboard/ltv",label:"LTV e coortes"},
  {href:"/dashboard/persona",label:"Persona"},{href:"/dashboard/segmentos",label:"Segmentos"},
  {href:"/dashboard/scoring",label:"Scoring"}]},
 {key:"funnels",label:"Funis e páginas",icon:"funnel",items:[
  {href:"/dashboard/funil",label:"Funil observado"},{href:"/dashboard/funis",label:"Definir funis"},
  {href:"/dashboard/experimentos",label:"Testes A/B"},
  {href:"/dashboard/simulador",label:"Simulador"}]},
 {key:"creatives",label:"Criativos",icon:"creatives",items:[
  {href:"/dashboard/criativos",label:"Biblioteca"},{href:"/dashboard/campanhas/criativos",label:"Criativos Meta"},
  {href:"/dashboard/campanhas/acoes",label:"Aprovações"}]},
 {key:"settings",label:"Configurações",icon:"integrations",items:[
  {href:"/dashboard/projetos",label:"Projetos"},{href:"/dashboard/operacao",label:"Operação"},{href:"/dashboard/integracoes",label:"Integrações"},
  {href:"/dashboard/dominios",label:"Domínios"},{href:"/dashboard/equipe",label:"Equipe"},
  {href:"/dashboard/alertas",label:"Alertas"},{href:"/dashboard/qualidade",label:"Qualidade dos dados"},
  {href:"/dashboard/auditoria",label:"Auditoria"}]},
] as const;

function routeMatches(activeHref:string,href:string){
 const pathname=href.split("?")[0]??href;
 if(pathname==="/dashboard-v2")return activeHref==="/dashboard-v2";
 if(pathname==="/dashboard/tracking")return activeHref==="/dashboard/tracking";
 return pathname==="/dashboard"?activeHref===pathname:activeHref===pathname||activeHref.startsWith(`${pathname}/`);
}

export function DashboardSidebarClient({activeHref,footerLabel="Dados conectados",projects,activeProjectId}:Props){
 const activeGroupKey=useMemo(()=>navigationGroups.flatMap(group=>group.items.map(item=>(
  {groupKey:group.key,href:item.href}))).filter(item=>routeMatches(activeHref,item.href))
  .sort((a,b)=>b.href.length-a.href.length)[0]?.groupKey??"overview",[activeHref]);
 const [collapsed,setCollapsed]=useState(false);
 const [mobileAberto,setMobileAberto]=useState(false);
 const [openGroup,setOpenGroup]=useState<string>(activeGroupKey);
 useEffect(()=>{const frame=requestAnimationFrame(()=>setCollapsed(window.localStorage.getItem("fm:sidebar:collapsed")==="true"));
  return ()=>cancelAnimationFrame(frame)},[]);
 useEffect(()=>{const frame=requestAnimationFrame(()=>setOpenGroup(activeGroupKey));
  return ()=>cancelAnimationFrame(frame)},[activeGroupKey]);
 function toggleSidebar(){setCollapsed(current=>{const next=!current;
  window.localStorage.setItem("fm:sidebar:collapsed",String(next));return next})}
 function toggleGroup(key:string){if(collapsed){setCollapsed(false);
  window.localStorage.setItem("fm:sidebar:collapsed","false")}setOpenGroup(current=>current===key?"":key)}
 return <aside className={`app-sidebar dashboard-sidebar${collapsed?" is-collapsed":""}${mobileAberto?" is-mobile-open":""}`} data-collapsed={collapsed}>
  <Link className="app-brand" href="/dashboard" aria-label="Funil Metrics"><span>F</span>
   <span className="brand-copy"><strong>Funil Metrics</strong><small>Inteligência de funil</small></span></Link>
  <ProjectSelector projects={projects} activeProjectId={activeProjectId} returnTo={activeHref} collapsed={collapsed}/>
  <button aria-label={mobileAberto?"Fechar menu":"Abrir menu"} aria-expanded={mobileAberto} className="sidebar-mobile-toggle"
   onClick={()=>setMobileAberto(current=>!current)} type="button">
   <span aria-hidden="true">{mobileAberto?"\u2715":"\u2630"}</span></button>
  <button aria-label={collapsed?"Expandir menu":"Recolher menu"} className="sidebar-toggle"
   onClick={toggleSidebar} title={collapsed?"Expandir menu":"Recolher menu"} type="button">
   <span aria-hidden="true">{collapsed?"›":"‹"}</span></button>
  <nav className="app-nav module-nav" aria-label="Navegação principal" onClick={event=>{if((event.target as HTMLElement).closest("a"))setMobileAberto(false)}}>{navigationGroups.map(group=>{
   const isActive=group.key===activeGroupKey,isOpen=group.key===openGroup&&(!collapsed||mobileAberto);
   return <section className={`module-group${isActive?" is-active":""}${isOpen?" is-open":""}`} key={group.key}>
    <button aria-expanded={isOpen} className="module-trigger" onClick={()=>toggleGroup(group.key)}
     title={collapsed?group.label:undefined} type="button"><i aria-hidden="true" className="nav-icon" data-icon={group.icon}/>
     <span className="nav-item-label">{group.label}</span><span aria-hidden="true" className="module-chevron">⌄</span></button>
    {isOpen?<div className="module-children">{group.items.map(item=>{const selected=routeMatches(activeHref,item.href);
     return <Link aria-current={selected?"page":undefined} className={selected?"active":undefined}
      href={item.href} key={item.href}><span>{item.label}</span></Link>})}</div>:null}</section>})}</nav>
  <div className="sidebar-footer"><span className="status-dot"/><span className="sidebar-footer-copy">
   <strong>Operação online</strong><small>{footerLabel}</small></span></div>
 </aside>;
}
