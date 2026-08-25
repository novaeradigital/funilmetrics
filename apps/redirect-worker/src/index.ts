type Variant={id:string;destinationUrl:string;weight:number};
type ExperimentConfig={id:string;organizationId:string;projectId:string;variants:Variant[]};
type Exposure={organizationId:string;projectId:string;experimentId:string;
 variantId:string;visitorKeyHash:string;utm:Record<string,string>;isBot:boolean;
 trackingToken:string;entryHostname:string;exposedAt:string};
type Env={API_BASE_URL:string;FALLBACK_ORIGIN:string;EDGE_SHARED_SECRET:string;
 CONFIG_CACHE_SECONDS?:string;PREVIEW_HOSTNAME?:string;EXPOSURES?:Queue<Exposure>};

const allowed=new Set(["utm_source","utm_medium","utm_campaign","utm_term",
 "utm_content","src","sck","vtid","fbclid"]);

function cookie(request:Request,name:string){
 const header=request.headers.get("cookie")??"";
 for(const item of header.split(";")){
  const [key,...value]=item.trim().split("=");
  if(key===name)return decodeURIComponent(value.join("="));
 }
 return null;
}
async function sha256(value:string){
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function assign(visitor:string,experimentId:string,variants:Variant[]){
 const total=variants.reduce((sum,item)=>sum+item.weight,0);
 if(total<=0)throw new Error("invalid_weight");
 const digest=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(`${experimentId}:${visitor}`));
 const point=new DataView(digest).getUint32(0)%total;
 let cursor=0;
 for(const variant of variants){cursor+=variant.weight;if(point<cursor)return variant;}
 return variants.at(-1)!;
}
function fallback(request:Request,env:Env){
 const source=new URL(request.url),target=new URL(source.pathname+source.search,env.FALLBACK_ORIGIN);
 return fetch(new Request(target,request));
}
async function getConfig(request:Request,env:Env,ctx:ExecutionContext,slug:string){
 const requestHostname=new URL(request.url).hostname.toLowerCase();
 const preview=requestHostname.endsWith(".workers.dev")&&Boolean(env.PREVIEW_HOSTNAME);
 const hostname=preview?env.PREVIEW_HOSTNAME!.toLowerCase():requestHostname;
 const key=new Request(`https://edge-cache.funilmetrics.local/${hostname}/${encodeURIComponent(slug)}`);
 const cache=(caches as unknown as {default:Cache}).default;
 const cached=await cache.match(key);
 if(cached)return cached.json<ExperimentConfig>();
 const endpoint=new URL("/edge/experiments/config",env.API_BASE_URL);
 endpoint.searchParams.set("hostname",hostname);endpoint.searchParams.set("slug",slug);
 if(preview)endpoint.searchParams.set("preview","1");
 const response=await fetch(endpoint,{headers:{"x-fm-edge-secret":env.EDGE_SHARED_SECRET}});
 if(!response.ok)throw new Error(`config_${response.status}`);
 const copy=new Response(response.body,response);
 copy.headers.set("Cache-Control",`public,max-age=${Number(env.CONFIG_CACHE_SECONDS??60)}`);
 ctx.waitUntil(cache.put(key,copy.clone()));
 return copy.json<ExperimentConfig>();
}
async function sendExposure(exposure:Exposure,env:Env,ctx:ExecutionContext){
 if(env.EXPOSURES){ctx.waitUntil(env.EXPOSURES.send(exposure));return;}
 ctx.waitUntil(fetch(new URL("/edge/exposures",env.API_BASE_URL),{
  method:"POST",headers:{"content-type":"application/json",
   "x-fm-edge-secret":env.EDGE_SHARED_SECRET},body:JSON.stringify([exposure]),
 }).then(()=>undefined).catch(()=>undefined));
}
async function redirect(request:Request,env:Env,ctx:ExecutionContext){
 const url=new URL(request.url),match=url.pathname.match(/^\/r\/([a-z0-9-]{1,100})\/?$/i);
 if(!match)return fallback(request,env);
 let config:ExperimentConfig;
 try{config=await getConfig(request,env,ctx,match[1]!);}
 catch{return fallback(request,env);}
 if(!config.variants.length)return fallback(request,env);
 const visitor=cookie(request,"fm_visitor")??crypto.randomUUID();
 const assignmentCookie=`fm_ab_${config.id.replaceAll("-","").slice(0,12)}`;
 const prior=cookie(request,assignmentCookie);
 const selected=config.variants.find(item=>item.id===prior) ??
  await assign(visitor,config.id,config.variants);
 const utm=Object.fromEntries([...url.searchParams.entries()].filter(([key])=>allowed.has(key)));
 const trackingToken=`fm_${crypto.randomUUID().replaceAll("-","")}`;
 const entryHostname=url.hostname.endsWith(".workers.dev")&&env.PREVIEW_HOSTNAME
  ?env.PREVIEW_HOSTNAME.toLowerCase():url.hostname.toLowerCase();
 const exposure:Exposure={organizationId:config.organizationId,projectId:config.projectId,
  experimentId:config.id,variantId:selected.id,visitorKeyHash:await sha256(visitor),
  utm,isBot:/bot|crawler|spider|preview|facebookexternalhit/i.test(
  request.headers.get("user-agent")??""),trackingToken,entryHostname,
  exposedAt:new Date().toISOString()};
 await sendExposure(exposure,env,ctx);
 const destination=new URL(selected.destinationUrl);
 for(const [key,value]of Object.entries(utm))
  if(!destination.searchParams.has(key))destination.searchParams.set(key,value);
 if(!destination.searchParams.has("sck"))destination.searchParams.set("sck",trackingToken);
 const headers=new Headers({Location:destination.toString(),"Cache-Control":"no-store"});
 if(!cookie(request,"fm_visitor"))headers.append("Set-Cookie",
  `fm_visitor=${encodeURIComponent(visitor)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
 if(!prior)headers.append("Set-Cookie",
  `${assignmentCookie}=${selected.id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
 return new Response(null,{status:302,headers});
}

export default {
 fetch:redirect,
 async queue(batch:MessageBatch<Exposure>,env:Env){
  const response=await fetch(new URL("/edge/exposures",env.API_BASE_URL),{
   method:"POST",headers:{"content-type":"application/json",
    "x-fm-edge-secret":env.EDGE_SHARED_SECRET},
   body:JSON.stringify(batch.messages.map(message=>message.body)),
  });
  if(!response.ok)throw new Error(`ingestion_${response.status}`);
  batch.ackAll();
 },
};
