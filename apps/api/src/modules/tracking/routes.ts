import type {FastifyInstance} from "fastify";import {z} from "zod";
import type {TrackingRepository,TrackingSource} from "./repository.js";
const types=["page_view","video_play","video_progress_25","video_progress_50",
 "video_progress_75","video_complete","cta_click","form_submit",
 "view_content","initiate_checkout"] as const;
const event=z.object({eventId:z.string().min(8).max(120),type:z.enum(types),
 visitorId:z.string().min(8).max(120).optional(),sessionId:z.string().min(8).max(120).optional(),
 occurredAt:z.iso.datetime(),pageUrl:z.url().max(2048),referrer:z.url().max(2048).optional(),
 fbclid:z.string().max(500).optional(),fbp:z.string().max(500).optional(),
 fbc:z.string().max(500).optional(),
 utm:z.object({source:z.string().max(200).optional(),medium:z.string().max(200).optional(),
  campaign:z.string().max(200).optional(),term:z.string().max(200).optional(),
  content:z.string().max(200).optional()}).strict().default({}),
 properties:z.record(z.string(),z.union([z.string().max(500),z.number(),z.boolean(),z.null()]))
  .default({})});
const body=z.object({events:z.array(event).min(1).max(25)});
const params=z.object({publicKey:z.uuid()});
const bot=/bot|crawler|spider|headless|preview/i;

const triggerTypes=new Set(["attribute","selector","id","url","url_part","domain"]);
type IcRule={type:string;value:string|null;label:string};
function normalizeRules(source:TrackingSource):IcRule[]{
 const raw=Array.isArray(source.ic_triggers)?source.ic_triggers:[];
 const rules:IcRule[]=[];
 for(const item of raw){
  if(!item||typeof item!=="object")continue;
  const type=typeof item.type==="string"&&triggerTypes.has(item.type)?item.type:"attribute";
  rules.push({type,value:typeof item.value==="string"&&item.value?item.value:null,
   label:typeof item.label==="string"?item.label.slice(0,80):""});
 }
 if(rules.length)return rules;
 return [{type:source.ic_trigger_type??"attribute",value:source.ic_trigger_value??null,label:""}];
}
function scriptConfig(source:TrackingSource){
 const pixelOn=Boolean(source.pixel_id&&source.pixel_active&&source.pixel_mode!=="off");
 return {
  pixelId:pixelOn?source.pixel_id:null,
  mode:pixelOn?(source.pixel_mode??"api"):"off",
  icTriggers:normalizeRules(source),
  productPage:Boolean(source.product_page),
 };
}

function buildScript(endpoint:string,config:ReturnType<typeof scriptConfig>){
 return `(()=>{const E=${JSON.stringify(endpoint)},CFG=${JSON.stringify(config)},K="fm_visitor_id",S="fm_session_id";
const id=()=>crypto.randomUUID(),get=(st,k)=>{let v=st.getItem(k);if(!v){v=id();st.setItem(k,v)}return v};
const visitor=get(localStorage,K),session=get(sessionStorage,S),sent=new WeakMap(),token="fmt_"+visitor.replaceAll("-","");
const ck=n=>{const p=document.cookie?document.cookie.split("; "):[];for(let i=0;i<p.length;i++){const kv=p[i].split("=");if(kv[0]===n)return decodeURIComponent(kv.slice(1).join("="))}return null};
const setCk=(n,v,d)=>{const t=new Date();t.setTime(t.getTime()+d*864e5);document.cookie=n+"="+encodeURIComponent(v)+"; expires="+t.toUTCString()+"; path=/; SameSite=Lax"};
const par=n=>new URLSearchParams(location.search).get(n);
const normFbc=v=>{if(!v)return v;const ps=String(v).split(".");if(ps.length>=4&&ps[0]==="fb"&&/^\\d{10}$/.test(ps[2])){ps[2]=String(parseInt(ps[2],10)*1000);return ps.join(".")}return v};
const fbclid=par("fbclid");let fbp=ck("_fbp")||par("_fbp")||ck("fm_fbp");
let fbc=normFbc(ck("_fbc")||par("_fbc")||ck("fm_fbc"));
if(!fbc&&fbclid)fbc="fb.1."+Date.now()+"."+fbclid;
if(!fbp)fbp="fb.1."+Date.now()+"."+Math.floor(Math.random()*1e10);
if(fbc){setCk("_fbc",fbc,90);setCk("fm_fbc",fbc,90)}if(fbp){setCk("_fbp",fbp,90);setCk("fm_fbp",fbp,90)}
const utm=()=>{const o={};for(const k of ["source","medium","campaign","term","content"]){const v=par("utm_"+k)||ck("fm_utm_"+k);if(v){o[k]=v;setCk("fm_utm_"+k,v,90)}}return o};
const U=utm();
let fbqFire=false;
if(CFG.pixelId){!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init",CFG.pixelId);fbqFire=(CFG.mode==="browser"||CFG.mode==="both")}
const metaNames={page_view:"PageView",view_content:"ViewContent",initiate_checkout:"InitiateCheckout"};
const newEventId=t=>"fm-"+t.replace("_","-")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
const track=(type,properties={})=>{const eventId=newEventId(type);
fetch(E,{method:"POST",headers:{"content-type":"application/json"},keepalive:true,
body:JSON.stringify({events:[{eventId,type,visitorId:visitor,sessionId:session,occurredAt:new Date().toISOString(),
pageUrl:location.href,referrer:document.referrer||undefined,utm:U,properties,fbclid:fbclid||undefined,fbp,fbc:fbc||undefined}]})}).catch(()=>{});
const mn=metaNames[type];if(mn&&fbqFire&&window.fbq)fbq("track",mn,{},{eventID:eventId});return eventId};
window.funilMetrics={track};
const decorate=a=>{try{const u=new URL(a.href);u.searchParams.set("sck",token);if(fbp)u.searchParams.set("_fbp",fbp);if(fbc)u.searchParams.set("_fbc",fbc);for(const k in U){const key="utm_"+k;if(!u.searchParams.has(key))u.searchParams.set(key,U[k])}a.href=u.toString()}catch{}};
const once=(key,fn)=>{try{if(sessionStorage.getItem(key)==="1")return;sessionStorage.setItem(key,"1")}catch{}fn()};
const fireIc=()=>once("fm_ic_"+location.pathname,()=>track("initiate_checkout"));
const byId=(t,v)=>{let n=t;while(n){if(n.id===v)return n;n=n.parentElement}return null};
const RULES=Array.isArray(CFG.icTriggers)?CFG.icTriggers:[];
const hostOf=v=>{try{return new URL(v).hostname}catch{const s=String(v||"").split("://")[1]||String(v||"");return s.split("/")[0].split(":")[0]}};
const anchorOf=t=>t.closest?.("a[href]")||(t.tagName==="A"?t:null);
const ruleMatches=(r,t)=>{const a=anchorOf(t);
if(r.type==="attribute")return Boolean(t.closest?.('[data-fm-evento="InitiateCheckout"]'));
if(!r.value)return false;
if(r.type==="selector"){try{return Boolean(t.closest?.(r.value))}catch{return false}}
if(r.type==="id")return Boolean(byId(t,r.value));
if(r.type==="url"||r.type==="url_part")return Boolean(a&&a.href.includes(r.value));
if(r.type==="domain")return Boolean(a&&hostOf(a.href)===hostOf(r.value));
return false};
const matchRule=t=>{for(const r of RULES)if(ruleMatches(r,t))return r;return null};
const fireRule=r=>once("fm_ic_"+location.pathname,()=>track("initiate_checkout",{trigger_type:r.type,trigger_value:r.value||null,trigger_label:r.label||null}));
const bind=()=>{
track("page_view");
if(CFG.productPage)track("view_content");
for(const r of RULES){if((r.type==="url"||r.type==="url_part")&&r.value&&location.href.includes(r.value)){fireRule(r);break}}
for(const r of RULES){
if(r.type==="selector"&&r.value){try{document.querySelectorAll(r.value).forEach(el=>{const a=el.closest?.("a[href]")||(el.tagName==="A"?el:null);if(a)decorate(a)})}catch{}}
if((r.type==="url"||r.type==="url_part")&&r.value){document.querySelectorAll("a[href]").forEach(a=>{if(a.href.includes(r.value))decorate(a)})}
if(r.type==="domain"&&r.value){document.querySelectorAll("a[href]").forEach(a=>{if(hostOf(a.href)===hostOf(r.value))decorate(a)})}}
document.querySelectorAll("video").forEach(v=>{if(sent.has(v))return;
sent.set(v,new Set());v.addEventListener("play",()=>track("video_play"));v.addEventListener("timeupdate",()=>{if(!v.duration)return;
const n=Math.floor(v.currentTime/v.duration*100),set=sent.get(v);for(const p of [25,50,75])if(n>=p&&!set.has(p)){set.add(p);track("video_progress_"+p,{videoId:v.id||null})}});
v.addEventListener("ended",()=>track("video_complete",{videoId:v.id||null}))});
document.addEventListener("click",e=>{const t=e.target;
const matched=matchRule(t);
const evEl=t.closest?.("[data-fm-evento]");
if(evEl){const name=evEl.getAttribute("data-fm-evento");const map={InitiateCheckout:"initiate_checkout",ViewContent:"view_content",PageView:"page_view"};const type=map[name];
if(type==="initiate_checkout"){if(matched)fireRule(matched);else fireIc()}else if(type)track(type);
const a=evEl.closest?.("a[href]")||(evEl.tagName==="A"?evEl:null);if(a)decorate(a)}
if(matched){fireRule(matched);const a=anchorOf(t);if(a)decorate(a)}
const c=t.closest?.("[data-fm-cta]");if(c){const a=c.closest?.("a[href]");if(a)decorate(a);
track("cta_click",{label:c.getAttribute("data-fm-cta")||null})}});
document.addEventListener("submit",e=>track("form_submit",{formId:e.target.id||null}),true)};
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",bind):bind()})();`;
}

export async function registerTrackingRoutes(app:FastifyInstance,repository:TrackingRepository){
 app.get("/track/v1/:publicKey/script.js",async(request,reply)=>{
  const parsed=params.safeParse(request.params);if(!parsed.success)return reply.code(404).send();
  const source=await repository.findPublicSource(parsed.data.publicKey);
  if(!source)return reply.code(404).send();
  const forwardedProto=typeof request.headers["x-forwarded-proto"]==="string"?(request.headers["x-forwarded-proto"].split(",")[0] ?? "").trim():undefined;
  const proto=forwardedProto==="https"||forwardedProto==="http"?forwardedProto:request.protocol;
  const endpoint=`${proto}://${request.headers.host}/track/v1/${parsed.data.publicKey}/events`;
  return reply.header("content-type","application/javascript; charset=utf-8")
   .header("cache-control","public, max-age=300").send(buildScript(endpoint,scriptConfig(source)));
 });
 app.options("/track/v1/:publicKey/events",async(request,reply)=>{
  const parsed=params.safeParse(request.params);if(!parsed.success)return reply.code(404).send();
  const origin=typeof request.headers.origin==="string"?request.headers.origin:undefined;
  const source=await repository.findSource(parsed.data.publicKey,origin);
  if(!source)return reply.code(403).send({status:"forbidden"});
  if(origin)reply.header("access-control-allow-origin",origin);
  return reply.header("access-control-allow-methods","POST,OPTIONS")
   .header("access-control-allow-headers","content-type").code(204).send();
 });
 app.post("/track/v1/:publicKey/events",async(request,reply)=>{
  const parsedParams=params.safeParse(request.params),parsedBody=body.safeParse(request.body);
  if(!parsedParams.success)return reply.code(404).send({status:"not_found"});
  if(!parsedBody.success)return reply.code(400).send({status:"invalid"});
  const origin=typeof request.headers.origin==="string"?request.headers.origin:undefined;
  const source=await repository.findSource(parsedParams.data.publicKey,origin);
  if(!source)return reply.code(403).send({status:"forbidden"});
  if(origin)reply.header("access-control-allow-origin",origin);
  const userAgent=typeof request.headers["user-agent"]==="string"?request.headers["user-agent"]:"";
  const forwarded=typeof request.headers["x-forwarded-for"]==="string"
   ? request.headers["x-forwarded-for"].split(",")[0]?.trim() : undefined;
  const result=await repository.insert(source,parsedBody.data.events.map(item=>({
   externalEventId:item.eventId,eventType:item.type,visitorId:item.visitorId,sessionId:item.sessionId,
   occurredAt:item.occurredAt,pageUrl:item.pageUrl,referrer:item.referrer,utm:item.utm,
   properties:item.properties,isBot:bot.test(userAgent),
   fbclid:item.fbclid,fbp:item.fbp,fbc:item.fbc})),
   {ip:forwarded||request.ip,userAgent});
  return reply.code(result.accepted?202:200).send({status:"accepted",...result});
 });
}
