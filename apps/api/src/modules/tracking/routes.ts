import type {FastifyInstance} from "fastify";import {z} from "zod";
import type {TrackingRepository} from "./repository.js";
const types=["page_view","video_play","video_progress_25","video_progress_50",
 "video_progress_75","video_complete","cta_click","form_submit"] as const;
const event=z.object({eventId:z.string().min(8).max(120),type:z.enum(types),
 visitorId:z.string().min(8).max(120).optional(),sessionId:z.string().min(8).max(120).optional(),
 occurredAt:z.iso.datetime(),pageUrl:z.url().max(2048),referrer:z.url().max(2048).optional(),
 utm:z.object({source:z.string().max(200).optional(),medium:z.string().max(200).optional(),
  campaign:z.string().max(200).optional(),term:z.string().max(200).optional(),
  content:z.string().max(200).optional()}).strict().default({}),
 properties:z.record(z.string(),z.union([z.string().max(500),z.number(),z.boolean(),z.null()]))
  .default({})});
const body=z.object({events:z.array(event).min(1).max(25)});
const params=z.object({publicKey:z.uuid()});
const bot=/bot|crawler|spider|headless|preview/i;
export async function registerTrackingRoutes(app:FastifyInstance,repository:TrackingRepository){
 app.get("/track/v1/:publicKey/script.js",async(request,reply)=>{
  const parsed=params.safeParse(request.params);if(!parsed.success)return reply.code(404).send();
  const source=await repository.findPublicSource(parsed.data.publicKey);
  if(!source)return reply.code(404).send();
  const endpoint=`${request.protocol}://${request.headers.host}/track/v1/${parsed.data.publicKey}/events`;
  const script=`(()=>{const E=${JSON.stringify(endpoint)},K="fm_visitor_id",S="fm_session_id";
const id=()=>crypto.randomUUID(),get=(storage,key)=>{let v=storage.getItem(key);if(!v){v=id();storage.setItem(key,v)}return v};
const visitor=get(localStorage,K),session=get(sessionStorage,S),sent=new WeakMap(),token="fmt_"+visitor.replaceAll("-","");
const utm=()=>{const p=new URLSearchParams(location.search),o={};for(const k of ["source","medium","campaign","term","content"]){const v=p.get("utm_"+k);if(v)o[k]=v}return o};
const track=(type,properties={})=>fetch(E,{method:"POST",headers:{"content-type":"application/json"},keepalive:true,
body:JSON.stringify({events:[{eventId:id(),type,visitorId:visitor,sessionId:session,occurredAt:new Date().toISOString(),
pageUrl:location.href,referrer:document.referrer||undefined,utm:utm(),properties}]})}).catch(()=>{});
window.funilMetrics={track};const bind=()=>{track("page_view");document.querySelectorAll("video").forEach(v=>{if(sent.has(v))return;
sent.set(v,new Set());v.addEventListener("play",()=>track("video_play"));v.addEventListener("timeupdate",()=>{if(!v.duration)return;
const n=Math.floor(v.currentTime/v.duration*100),set=sent.get(v);for(const p of [25,50,75])if(n>=p&&!set.has(p)){set.add(p);track("video_progress_"+p,{videoId:v.id||null})}});
v.addEventListener("ended",()=>track("video_complete",{videoId:v.id||null}))});
document.addEventListener("click",e=>{const t=e.target.closest?.("[data-fm-cta]");if(t){const a=t.closest?.("a[href]");if(a){try{const u=new URL(a.href);if(!u.searchParams.has("sck")){u.searchParams.set("sck",token);a.href=u.toString()}}catch{}}
track("cta_click",{label:t.getAttribute("data-fm-cta")||null})}});
document.addEventListener("submit",e=>track("form_submit",{formId:e.target.id||null}),true)};
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",bind):bind()})();`;
  return reply.header("content-type","application/javascript; charset=utf-8")
   .header("cache-control","public, max-age=300").send(script);
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
  const result=await repository.insert(source,parsedBody.data.events.map(item=>({
   externalEventId:item.eventId,eventType:item.type,visitorId:item.visitorId,sessionId:item.sessionId,
   occurredAt:item.occurredAt,pageUrl:item.pageUrl,referrer:item.referrer,utm:item.utm,
   properties:item.properties,isBot:bot.test(userAgent)})));
  return reply.code(result.accepted?202:200).send({status:"accepted",...result});
 });
}
