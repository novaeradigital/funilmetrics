"use client";
import {useMemo,useState,useTransition} from "react";
import {createUpload,saveTemplate,generateCopies,getDestinationPages,getDestinationPixels,type DestinationPage,type DestinationPixel} from "./actions";
import {expandStructure,resolveNamingPattern,resolveUtmParams,legacyUtmsToParams,DEFAULT_UTM_PARAMS,type NamingContext} from "../../../../lib/campaign-naming";
import {CreativeImportPanel} from "../../criativos/creative-import-panel";
import {useRouter} from "next/navigation";

export type WizardAccount={id:string;externalId:string;name:string;currency:string|null};
export type WizardCreative={id:string;name:string;format:string;mimeType:string;transcript:string|null;folderId:string|null;folderName:string|null};
export type WizardFolder={id:string;name:string};
export type WizardTemplate={id:string;name:string;config:Record<string,unknown>};
type CopyModel={primaryText:string;headline:string;cta:string};
const CTA_OPTIONS=["Saiba mais","Comprar agora","Cadastre-se","Quero começar","Entre em contato","Baixar agora"];
type DestinationState={pageId:string;instagramId:string;pixelId:string;event:string};
type PagesState={loading:boolean;error?:string;pages:DestinationPage[]};
type PixelsState={loading:boolean;error?:string;pixels:DestinationPixel[]};

const OBJECTIVES=["OUTCOME_SALES","OUTCOME_LEADS","OUTCOME_TRAFFIC","OUTCOME_ENGAGEMENT","OUTCOME_AWARENESS"];
const EVENTS=["Purchase","Lead","CompleteRegistration","InitiateCheckout","ViewContent"];

export function UploadWizard({accounts,creatives,templates,products,folders}:{
 accounts:WizardAccount[];creatives:WizardCreative[];templates:WizardTemplate[];products:string[];folders:WizardFolder[];
}){
 const [step,setStep]=useState(1);
 const [selectedAccounts,setSelectedAccounts]=useState<string[]>([]);
 const [destinations,setDestinations]=useState<Record<string,DestinationState>>({});
 const [selectedCreatives,setSelectedCreatives]=useState<string[]>([]);
 const [creativeSearch,setCreativeSearch]=useState("");
 const [creativeFolder,setCreativeFolder]=useState("");
 const [productName,setProductName]=useState(products[0]??"");
 const [preset,setPreset]=useState("1-3-1");
 const [structure,setStructure]=useState({campaigns:1,adSetsPerCampaign:3,adsPerAdSet:1,duplications:1,distribution:"rotate" as "rotate"|"sequence"|"all"});
 const [adSet,setAdSet]=useState({objective:"OUTCOME_SALES",budgetLevel:"adset" as "campaign"|"adset",dailyBudget:50,countries:"BR",ageMin:18,ageMax:65,gender:"all",destinationUrl:""});
 const [naming,setNaming]=useState({campaignPattern:"{produto} | {pais} | {data}",adSetPattern:"{publico} | {pais}",adPattern:"{criativo}",separator:"_",casing:"original" as "original"|"upper"|"lower",dateFormat:"YYYYMMDD"});
 const [utmParams,setUtmParams]=useState(DEFAULT_UTM_PARAMS);
 const [copyMode,setCopyMode]=useState<"global"|"per_creative">("global");
 const [generated,setGenerated]=useState<Record<string,CopyModel[]>>({});
 const [chosen,setChosen]=useState<Record<string,number>>({});
 const [edited,setEdited]=useState<Record<string,CopyModel>>({});
 const [copyError,setCopyError]=useState("");
 const [pagesByAccount,setPagesByAccount]=useState<Record<string,PagesState>>({});
 const [pixelsByAccount,setPixelsByAccount]=useState<Record<string,PixelsState>>({});
 const [pending,startTransition]=useTransition();

 const router=useRouter();
 const creativeById=useMemo(()=>new Map(creatives.map(c=>[c.id,c])),[creatives]);
 const visibleCreatives=useMemo(()=>creatives.filter(c=>
  (!creativeFolder||(creativeFolder==="none"?!c.folderId:c.folderId===creativeFolder))
  &&(!creativeSearch||c.name.toLowerCase().includes(creativeSearch.toLowerCase()))),
  [creatives,creativeFolder,creativeSearch]);
 const selectedCreativeObjs=selectedCreatives.map(id=>creativeById.get(id)).filter(Boolean) as WizardCreative[];

 function applyPreset(value:string){
  setPreset(value);
  if(value==="1-3-1")setStructure(s=>({...s,campaigns:1,adSetsPerCampaign:3,adsPerAdSet:1}));
  if(value==="1-1-1")setStructure(s=>({...s,campaigns:1,adSetsPerCampaign:1,adsPerAdSet:1}));
 }
 function toggleAccount(externalId:string){
  const selecting=!selectedAccounts.includes(externalId);
  setSelectedAccounts(prev=>prev.includes(externalId)?prev.filter(a=>a!==externalId):[...prev,externalId]);
  setDestinations(prev=>prev[externalId]?prev:{...prev,[externalId]:{pageId:"",instagramId:"",pixelId:"",event:"Purchase"}});
  if(selecting&&!pagesByAccount[externalId]){
   setPagesByAccount(prev=>({...prev,[externalId]:{loading:true,pages:[]}}));
   getDestinationPages(externalId).then(result=>{
    setPagesByAccount(prev=>({...prev,[externalId]:result.ok
     ?{loading:false,pages:result.pages??[]}
     :{loading:false,error:result.error??"Nao foi possivel carregar as paginas.",pages:[]}}));
   }).catch(()=>{
    setPagesByAccount(prev=>({...prev,[externalId]:{loading:false,error:"Nao foi possivel carregar as paginas.",pages:[]}}));
   });
  }
  if(selecting&&!pixelsByAccount[externalId]){
   setPixelsByAccount(prev=>({...prev,[externalId]:{loading:true,pixels:[]}}));
   getDestinationPixels(externalId).then(result=>{
    setPixelsByAccount(prev=>({...prev,[externalId]:result.ok
     ?{loading:false,pixels:result.pixels??[]}
     :{loading:false,error:result.error??"Nao foi possivel carregar os pixels.",pixels:[]}}));
   }).catch(()=>{
    setPixelsByAccount(prev=>({...prev,[externalId]:{loading:false,error:"Nao foi possivel carregar os pixels.",pixels:[]}}));
   });
  }
 }
 function choosePage(externalId:string,pageId:string){
  const page=pagesByAccount[externalId]?.pages.find(entry=>entry.id===pageId);
  setDestinations(prev=>{
   const current=prev[externalId]??{pageId:"",instagramId:"",pixelId:"",event:"Purchase"};
   const instagramOk=!current.instagramId||current.instagramId===(page?.instagramId??"__none__");
   return {...prev,[externalId]:{...current,pageId,instagramId:instagramOk?current.instagramId:""}};
  });
 }
 function toggleCreative(id:string){
  setSelectedCreatives(prev=>prev.includes(id)?prev.filter(c=>c!==id):[...prev,id]);
 }
 const namingOpts={separator:naming.separator,casing:naming.casing,dateFormat:naming.dateFormat as never};
 function baseContext(accountName:string):NamingContext{
  return {produto:productName||undefined,pais:adSet.countries||undefined,data:new Date(),
   conta:accountName,objetivo:adSet.objective,orcamento:adSet.dailyBudget,publico:undefined};
 }
 type PreviewAd={name:string;creative:string;url:string;utmParams:string};
 type PreviewAdSet={name:string;ads:PreviewAd[]};
 type PreviewCampaign={name:string;adSets:PreviewAdSet[]};
 const preview=useMemo(()=>{
  const empty={campaigns:[] as PreviewCampaign[],duplicates:0,totalAds:0,totalAdSets:0,totalCampaigns:0,repeatedCreative:false};
  if(!selectedAccounts.length||!selectedCreativeObjs.length)return empty;
  const account=accounts.find(a=>a.externalId===selectedAccounts[0]);
  const slots=expandStructure(structure,selectedCreativeObjs.length);
  const campaignMap=new Map<number,PreviewCampaign>();
  const adSetMap=new Map<string,PreviewAdSet>();
  const adNames:string[]=[];
  let repeatedCreative=false;
  const seenInCampaign=new Map<number,Set<number>>();
  for(const slot of slots){
   const creative=selectedCreativeObjs[slot.creativeIndex]!;
   const ctx={...baseContext(account?.name??""),criativo:creative.name,formato:creative.format,sequencia:slot.sequence};
   const campaignName=resolveNamingPattern(naming.campaignPattern,ctx,namingOpts);
   const adSetName=resolveNamingPattern(naming.adSetPattern,ctx,namingOpts);
   const adName=resolveNamingPattern(naming.adPattern,ctx,namingOpts);
   adNames.push(adName);
   const seen=seenInCampaign.get(slot.campaignIndex)??new Set<number>();
   if(seen.has(slot.creativeIndex)&&structure.distribution!=="all")repeatedCreative=true;
   seen.add(slot.creativeIndex);seenInCampaign.set(slot.campaignIndex,seen);
   let campaign=campaignMap.get(slot.campaignIndex);
   if(!campaign){campaign={name:campaignName,adSets:[]};campaignMap.set(slot.campaignIndex,campaign);}
   const adSetKey=`${slot.campaignIndex}:${slot.adSetIndex}`;
   let adSetEntry=adSetMap.get(adSetKey);
   if(!adSetEntry){adSetEntry={name:adSetName,ads:[]};adSetMap.set(adSetKey,adSetEntry);campaign.adSets.push(adSetEntry);}
   const utmQuery=resolveUtmParams(utmParams,{...ctx,campanha:campaignName,anuncio:adName},namingOpts);
   adSetEntry.ads.push({name:adName,creative:creative.name,
    url:adSet.destinationUrl,utmParams:utmQuery});
  }
  const campaigns=[...campaignMap.values()];
  return {campaigns,
   duplicates:adNames.length-new Set(adNames).size,
   totalAds:slots.length*selectedAccounts.length,
   totalAdSets:campaigns.reduce((n,c)=>n+c.adSets.length,0)*selectedAccounts.length,
   totalCampaigns:campaigns.length*selectedAccounts.length,
   repeatedCreative};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[selectedAccounts,selectedCreativeObjs,structure,naming,utmParams,adSet,productName]);

 function currentConfig(){
  return {
   version:"campaign_upload_v1",
   destinations:selectedAccounts.map(ext=>{
    const account=accounts.find(a=>a.externalId===ext)!;
    const d=destinations[ext]??{pageId:"",instagramId:"",pixelId:"",event:"Purchase"};
    return {accountId:account.id,accountExternalId:ext,accountName:account.name,...d};
   }),
   creatives:selectedCreativeObjs.map(c=>({id:c.id,name:c.name,format:c.format,transcript:c.transcript})),
   structure,adSet,naming,utmParams,productName,
   copies:{mode:copyMode,
    global:copyMode==="global"?edited["__global"]:undefined,
    perCreative:copyMode==="per_creative"?Object.fromEntries(
     selectedCreativeObjs.filter(c=>edited[c.id]).map(c=>[c.id,edited[c.id]!])):undefined},
  };
 }
 function runGenerate(){
  setCopyError("");
  startTransition(async()=>{
   const items=copyMode==="global"
    ? [{creativeId:selectedCreativeObjs[0]?.id??"__global",key:"__global",name:selectedCreativeObjs[0]?.name??"geral",transcript:selectedCreativeObjs[0]?.transcript??null}]
    : selectedCreativeObjs.map(c=>({creativeId:c.id,key:c.id,name:c.name,transcript:c.transcript}));
   const result=await generateCopies({productName,items});
   if(!result.ok){setCopyError(result.error??"Falha na geracao.");return;}
   setGenerated(result.copies??{});
   const nextChosen:Record<string,number>={};const nextEdited:Record<string,CopyModel>={...edited};
   for(const [key,list] of Object.entries(result.copies??{})){
    nextChosen[key]=0;if(list[0])nextEdited[key]=list[0];
   }
   setChosen(nextChosen);setEdited(nextEdited);
  });
 }
 function copyEditor(scopeKey:string,label:string){
  const list=generated[scopeKey]??[];
  const current=edited[scopeKey];
  return <fieldset key={scopeKey} style={{border:"1px solid #ddd",borderRadius:8,padding:12,marginBottom:12}}>
   <legend>{label}</legend>
   {!list.length?<p>Nenhum modelo gerado ainda.</p>:list.map((copy,index)=>
    <label key={index} style={{display:"block",marginBottom:6}}>
     <input type="radio" name={`copy-${scopeKey}`} checked={(chosen[scopeKey]??0)===index}
      onChange={()=>{setChosen(p=>({...p,[scopeKey]:index}));setEdited(p=>({...p,[scopeKey]:list[index]!}));}}/>
     {` Modelo ${index+1}: ${copy.headline} (${copy.cta})`}
    </label>)}
   {current?<>
    <label style={{display:"block"}}>Texto principal<textarea rows={3} style={{width:"100%"}} value={current.primaryText}
     onChange={e=>setEdited(p=>({...p,[scopeKey]:{...current,primaryText:e.target.value}}))}/></label>
    <label style={{display:"block"}}>Titulo<input style={{width:"100%"}} value={current.headline}
     onChange={e=>setEdited(p=>({...p,[scopeKey]:{...current,headline:e.target.value}}))}/></label>
    <label style={{display:"block"}}>Botao (CTA)<select style={{width:"100%"}} value={current.cta}
     onChange={e=>setEdited(p=>({...p,[scopeKey]:{...current,cta:e.target.value}}))}>
     {(CTA_OPTIONS.includes(current.cta)?CTA_OPTIONS:[current.cta,...CTA_OPTIONS]).map(option=>
      <option key={option} value={option}>{option}</option>)}
    </select></label>
   </>:null}
  </fieldset>;
 }
 const configJson=JSON.stringify(currentConfig());
 const canNext=[true,selectedAccounts.length>0,selectedCreatives.length>0,true,Boolean(adSet.destinationUrl)][step]??true;

 return <div>
  <nav aria-label="Etapas da subida" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
   {["1. Destino","2. Criativos","3. Estrutura","4. Conjunto","5. Copys e revisao"].map((label,index)=>
    <button key={label} type="button" className={step===index+1?"period-active":"secondary-button"}
     style={step===index+1?{background:"#f59e0b",color:"#1a1207",fontWeight:700,borderColor:"#f59e0b",boxShadow:"0 0 0 2px rgba(245,158,11,.35)"}:undefined}
     aria-current={step===index+1?"step":undefined}
     onClick={()=>setStep(index+1)}>{label}</button>)}
  </nav>

  {step===1&&<section className="dashboard-card">
   <h2>Destino</h2>
   <p>Selecione uma ou varias contas. Pagina, pixel e evento sao por conta.</p>
   {accounts.map(account=><div key={account.externalId} style={{borderTop:"1px solid #eee",padding:"10px 0"}}>
    <label><input type="checkbox" checked={selectedAccounts.includes(account.externalId)}
     onChange={()=>toggleAccount(account.externalId)}/> <strong>{account.name}</strong> ({account.externalId}) {account.currency??""}</label>
    {selectedAccounts.includes(account.externalId)&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
     <label>Pagina{pagesByAccount[account.externalId]?.loading
      ?<span>Carregando paginas...</span>
      :pagesByAccount[account.externalId]?.error
       ?<span style={{color:"#c0392b"}}>{pagesByAccount[account.externalId]?.error}</span>
       :<select value={destinations[account.externalId]?.pageId??""}
         onChange={e=>choosePage(account.externalId,e.target.value)}>
         <option value="">Selecione a pagina</option>
         {(pagesByAccount[account.externalId]?.pages??[]).map(page=>
          <option key={page.id} value={page.id}>{page.name}</option>)}
        </select>}</label>
     <label>Instagram<select value={destinations[account.externalId]?.instagramId??""}
      onChange={e=>setDestinations(p=>({...p,[account.externalId]:{...(p[account.externalId]??{pageId:"",pixelId:"",event:"Purchase"}),instagramId:e.target.value}}))}>
      <option value="">Sem Instagram (so Pagina)</option>
      {(()=>{const sel=pagesByAccount[account.externalId]?.pages.find(page=>page.id===(destinations[account.externalId]?.pageId??""));
       return sel?.instagramId?<option value={sel.instagramId}>@{sel.instagramUsername||sel.instagramId}</option>:null;})()}
     </select></label>
     <label>Pixel{pixelsByAccount[account.externalId]?.loading
      ?<span>Carregando pixels...</span>
      :pixelsByAccount[account.externalId]?.error
       ?<span style={{color:"#c0392b"}}>{pixelsByAccount[account.externalId]?.error}</span>
       :<select value={destinations[account.externalId]?.pixelId??""}
         onChange={e=>setDestinations(p=>({...p,[account.externalId]:{...(p[account.externalId]??{pageId:"",instagramId:"",event:"Purchase"}),pixelId:e.target.value}}))}>
         <option value="">Sem pixel (opcional)</option>
         {(pixelsByAccount[account.externalId]?.pixels??[]).map(pixel=>
          <option key={pixel.id} value={pixel.id}>{pixel.name}</option>)}
        </select>}</label>
     <label>Evento<select value={destinations[account.externalId]?.event??"Purchase"}
      onChange={e=>setDestinations(p=>({...p,[account.externalId]:{...(p[account.externalId]??{pageId:"",instagramId:"",pixelId:""}),event:e.target.value}}))}>
      {EVENTS.map(ev=><option key={ev} value={ev}>{ev}</option>)}</select></label>
    </div>}
   </div>)}
   {!accounts.length&&<p>Nenhuma conta de anuncio sincronizada neste projeto.</p>}
  </section>}

  {step===2&&<section className="dashboard-card">
   <h2>Criativos da Biblioteca</h2>
   <p>Escolha os criativos prontos da Biblioteca ou envie arquivos novos aqui mesmo. Depois do processamento (antivirus), clique em Atualizar lista para eles aparecerem.</p>
   <div style={{border:"1px dashed #ccc",borderRadius:8,padding:12,margin:"10px 0"}}>
    <strong>Enviar arquivos agora</strong>
    <CreativeImportPanel folders={folders}/>
    <button type="button" className="secondary-button" onClick={()=>router.refresh()}>Atualizar lista</button>
   </div>
   <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",margin:"10px 0"}}>
    <button type="button" className={!creativeFolder?"period-active":"secondary-button"} onClick={()=>setCreativeFolder("")}>Todas as pastas</button>
    {folders.map(folder=><button key={folder.id} type="button" className={creativeFolder===folder.id?"period-active":"secondary-button"} onClick={()=>setCreativeFolder(folder.id)}>{folder.name}</button>)}
    <button type="button" className={creativeFolder==="none"?"period-active":"secondary-button"} onClick={()=>setCreativeFolder("none")}>Sem pasta</button>
   </div>
   <label>Buscar criativo<input value={creativeSearch} onChange={e=>setCreativeSearch(e.target.value)} placeholder="Nome do criativo"/></label>
   <p>{visibleCreatives.length} criativo(s) visivel(is) · {selectedCreatives.length} selecionado(s)</p>
   {visibleCreatives.map(creative=><div key={creative.id} style={{borderTop:"1px solid #eee",padding:"8px 0"}}>
    <label><input type="checkbox" checked={selectedCreatives.includes(creative.id)} onChange={()=>toggleCreative(creative.id)}/>
    <strong>{creative.name}</strong> ({creative.format}){creative.folderName?` · pasta ${creative.folderName}`:""} {creative.transcript?" · com transcricao":" · sem transcricao"}</label>
   </div>)}
   {creatives.length>0&&!visibleCreatives.length&&<p>Nenhum criativo nesta pasta ou busca.</p>}
   {!creatives.length&&<p>Nenhum criativo pronto na Biblioteca deste projeto.</p>}
  </section>}

  {step===3&&<section className="dashboard-card">
   <h2>Estrutura</h2>
   <label>Preset<select value={preset} onChange={e=>applyPreset(e.target.value)}>
    <option value="1-3-1">1-3-1</option><option value="1-1-1">1-1-1</option><option value="custom">Personalizada</option>
   </select></label>
   <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
    <label>Campanhas<input type="number" min={1} value={structure.campaigns} onChange={e=>{setPreset("custom");setStructure(s=>({...s,campaigns:Number(e.target.value)}));}}/></label>
    <label>Conjuntos por campanha<input type="number" min={1} value={structure.adSetsPerCampaign} onChange={e=>{setPreset("custom");setStructure(s=>({...s,adSetsPerCampaign:Number(e.target.value)}));}}/></label>
    <label>Anuncios por conjunto<input type="number" min={1} value={structure.adsPerAdSet} onChange={e=>{setPreset("custom");setStructure(s=>({...s,adsPerAdSet:Number(e.target.value)}));}}/></label>
    <label>Duplicacoes<input type="number" min={1} value={structure.duplications} onChange={e=>setStructure(s=>({...s,duplications:Number(e.target.value)}))}/></label>
    <label>Distribuicao dos criativos<select value={structure.distribution} onChange={e=>setStructure(s=>({...s,distribution:e.target.value as never}))}>
     <option value="rotate">Rodizio</option><option value="sequence">Na ordem</option><option value="all">Todos em cada conjunto</option>
    </select></label>
   </div>
   <p>Matriz: {preview.totalCampaigns} campanha(s), {preview.totalAdSets} conjunto(s) e {preview.totalAds} anuncio(s) no total, em {selectedAccounts.length} conta(s).</p>
  </section>}

  {step===4&&<section className="dashboard-card">
   <h2>Conjunto de anuncios</h2>
   <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
    <label>Objetivo<select value={adSet.objective} onChange={e=>setAdSet(s=>({...s,objective:e.target.value}))}>
     {OBJECTIVES.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
    <label>Orcamento no<select value={adSet.budgetLevel} onChange={e=>setAdSet(s=>({...s,budgetLevel:e.target.value as never}))}>
     <option value="adset">Conjunto (ABO)</option><option value="campaign">Campanha (CBO)</option></select></label>
    <label>Orcamento diario<input type="number" min={1} value={adSet.dailyBudget} onChange={e=>setAdSet(s=>({...s,dailyBudget:Number(e.target.value)}))}/></label>
    <label>Paises<input value={adSet.countries} onChange={e=>setAdSet(s=>({...s,countries:e.target.value}))}/></label>
    <label>Idade min<input type="number" value={adSet.ageMin} onChange={e=>setAdSet(s=>({...s,ageMin:Number(e.target.value)}))}/></label>
    <label>Idade max<input type="number" value={adSet.ageMax} onChange={e=>setAdSet(s=>({...s,ageMax:Number(e.target.value)}))}/></label>
    <label>Genero<select value={adSet.gender} onChange={e=>setAdSet(s=>({...s,gender:e.target.value}))}>
     <option value="all">Todos</option><option value="female">Feminino</option><option value="male">Masculino</option></select></label>
    <label style={{flex:1}}>URL de destino<input style={{width:"100%"}} value={adSet.destinationUrl} onChange={e=>setAdSet(s=>({...s,destinationUrl:e.target.value}))}/></label>
   </div>
   <h3>Nomenclatura</h3>
   <label style={{display:"block"}}>Produto<input style={{width:"100%"}} list="wizard-products" value={productName} onChange={e=>setProductName(e.target.value)}/></label>
   <datalist id="wizard-products">{products.map(p=><option key={p} value={p}/>)}</datalist>
   <label style={{display:"block"}}>Campanha<input style={{width:"100%"}} value={naming.campaignPattern} onChange={e=>setNaming(s=>({...s,campaignPattern:e.target.value}))}/></label>
   <label style={{display:"block"}}>Conjunto<input style={{width:"100%"}} value={naming.adSetPattern} onChange={e=>setNaming(s=>({...s,adSetPattern:e.target.value}))}/></label>
   <label style={{display:"block"}}>Anuncio<input style={{width:"100%"}} value={naming.adPattern} onChange={e=>setNaming(s=>({...s,adPattern:e.target.value}))}/></label>
   <div style={{display:"flex",gap:12}}>
    <label>Separador<input value={naming.separator} onChange={e=>setNaming(s=>({...s,separator:e.target.value}))}/></label>
    <label>Caixa<select value={naming.casing} onChange={e=>setNaming(s=>({...s,casing:e.target.value as never}))}>
     <option value="original">Original</option><option value="upper">Maiusculas</option><option value="lower">Minusculas</option></select></label>
   </div>
   <h3>UTMs</h3>
   <label style={{display:"block"}}>Parametros UTMs<input style={{width:"100%"}} value={utmParams} onChange={e=>setUtmParams(e.target.value)}/></label>
   <p>Os parametros vao no campo de parametros de URL (url_tags) do anuncio, nunca no link de destino. Macros da Meta como {"{{ad.id}}"} vao literais e a Meta resolve no clique. Variaveis do Funil aceitas: {"{criativo}"}, {"{campanha}"}, {"{anuncio}"}, {"{produto}"}, {"{data}"} e as demais da nomenclatura.</p>
   {templates.length>0&&<div>
    <h3>Modelos de subida</h3>
    <select defaultValue="" onChange={e=>{
     const template=templates.find(t=>t.id===e.target.value);if(!template)return;
     const cfg=template.config as {adSet?:typeof adSet;naming?:typeof naming;utmParams?:string;utms?:Record<string,string>;structure?:typeof structure};
     if(cfg.adSet)setAdSet(cfg.adSet);if(cfg.naming)setNaming(cfg.naming);
     if(typeof cfg.utmParams==="string")setUtmParams(cfg.utmParams);
     else if(cfg.utms)setUtmParams(legacyUtmsToParams(cfg.utms));
     if(cfg.structure)setStructure(cfg.structure);
    }}>
     <option value="">Aplicar modelo...</option>
     {templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
   </div>}
   <form action={saveTemplate} style={{marginTop:12}}>
    <input type="hidden" name="config" value={JSON.stringify({adSet,naming,utmParams,structure})}/>
    <label>Nome do modelo<input name="name" required/></label>
    <button type="submit" className="secondary-button">Salvar como modelo</button>
   </form>
  </section>}

  {step===5&&<section className="dashboard-card">
   <h2>Copys</h2>
   <label>Modo<select value={copyMode} onChange={e=>setCopyMode(e.target.value as never)}>
    <option value="global">3 modelos para a subida inteira</option>
    <option value="per_creative">3 modelos por criativo</option>
   </select></label>
   <button type="button" className="secondary-button" disabled={pending||!selectedCreativeObjs.length} onClick={runGenerate}>
    {pending?"Gerando...":"Gerar 3 modelos com IA"}</button>
   {copyMode==="global"
    ? copyEditor("__global","Subida inteira (gerado a partir do primeiro criativo)")
    : selectedCreativeObjs.map(c=>copyEditor(c.id,c.name))}
   {copyError&&<p role="alert">{copyError}</p>}
   <h2>Revisao</h2>
   <p><strong>{preview.totalCampaigns} campanha(s), {preview.totalAdSets} conjunto(s) e {preview.totalAds} anuncio(s)</strong> em {selectedAccounts.length} conta(s). A arvore abaixo mostra a primeira conta; as demais repetem a mesma estrutura.</p>
   {preview.repeatedCreative&&<p>Voce selecionou {selectedCreativeObjs.length} criativo(s), mas a estrutura pede mais anuncios por campanha: o mesmo criativo se repete em conjuntos diferentes. Numa 1-3-1, o comum e um criativo diferente por conjunto. Se a repeticao for intencional, tudo bem.</p>}
   {preview.duplicates>0&&<p role="alert">{preview.duplicates} nome(s) de anuncio duplicado(s) na previa. Ajuste a nomenclatura (por exemplo, com {"{sequencia}"}).</p>}
   {preview.campaigns.map((campaign,campaignIndex)=><div key={campaignIndex} style={{border:"1px solid #ddd",borderRadius:8,padding:12,marginBottom:12}}>
    <strong>Campanha: {campaign.name}</strong>
    {campaign.adSets.map((adSetItem,adSetIndex)=><div key={adSetIndex} style={{marginLeft:16,marginTop:8}}>
     <div>Conjunto: {adSetItem.name}</div>
     {adSetItem.ads.map((ad,adIndex)=><div key={adIndex} style={{marginLeft:16,marginTop:4}}>
      <div>Anuncio: {ad.name} - Criativo: {ad.creative}</div>
      <div style={{wordBreak:"break-all"}}>{ad.url}</div>
      <div style={{wordBreak:"break-all"}}>Parametros: {ad.utmParams}</div>
     </div>)}
    </div>)}
   </div>)}
   <form action={createUpload}>
    <input type="hidden" name="config" value={configJson}/>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
     <button type="submit" name="send_mode" value="draft" className="secondary-button">Salvar rascunho</button>
     <button type="submit" name="send_mode" value="paused">Enviar pausada</button>
     <button type="submit" name="send_mode" value="active">Enviar ativa</button>
    </div>
   </form>
  </section>}

  <div style={{display:"flex",gap:8,marginTop:16}}>
   {step>1&&<button type="button" className="secondary-button" onClick={()=>setStep(step-1)}>Voltar</button>}
   {step<5&&<button type="button" disabled={!canNext} onClick={()=>setStep(step+1)}>Continuar</button>}
  </div>
 </div>;
}
