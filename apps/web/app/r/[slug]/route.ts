import {createHash,randomUUID} from "node:crypto";
import {NextResponse,type NextRequest} from "next/server";
import {getDatabase} from "../../../lib/database";
import {assignWeighted} from "../../../lib/weighted-assignment";
const COOKIE="fm_visitor";
const allowed=new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","src","sck","vtid","fbclid"]);
export async function GET(request:NextRequest,{params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;const database=getDatabase();
  const hostname=(request.headers.get("x-forwarded-host")??request.headers.get("host")??
    request.nextUrl.hostname).split(",")[0]!.trim().split(":")[0]!.toLowerCase();
  const customDomain=(await database.pool.query<{project_id:string}>(`select project_id
    from public.custom_domains where hostname=$1 and status='active' limit 1`,[hostname])).rows[0];
  const defaultHosts=new Set(["localhost","127.0.0.1",process.env.RAILWAY_PUBLIC_DOMAIN].filter(Boolean));
  try{if(process.env.APP_URL)defaultHosts.add(new URL(process.env.APP_URL).hostname)}catch{}
  if(!customDomain&&!defaultHosts.has(hostname))
    return new NextResponse("Domínio indisponível",{status:404});
  const experiment=(await database.pool.query<{id:string;organization_id:string;project_id:string}>(
    `select id,organization_id,project_id from public.experiments
      where slug=$1 and status='active' and ($2::uuid is null or project_id=$2) limit 1`,
    [slug,customDomain?.project_id??null])).rows[0];
  if(!experiment)return new NextResponse("Link indisponível",{status:404});
  const variants=(await database.pool.query<{id:string;destination_url:string;weight:number}>(
    `select id,destination_url,weight from public.experiment_variants where experiment_id=$1 order by position`,
    [experiment.id])).rows;
  if(!variants.length)return new NextResponse("Destino indisponível",{status:503});
  const visitor=request.cookies.get(COOKIE)?.value??randomUUID();
  const visitorHash=createHash("sha256").update(visitor).digest("hex");
  const candidate=assignWeighted(visitor,experiment.id,variants);
  const utm=Object.fromEntries([...request.nextUrl.searchParams.entries()].filter(([key])=>allowed.has(key)));
  const userAgent=request.headers.get("user-agent")??"";
  const isBot=/bot|crawler|spider|preview|facebookexternalhit/i.test(userAgent);
  const trackingToken=`fm_${randomUUID().replaceAll("-","")}`;
  const persisted=(await database.pool.query<{variant_id:string;tracking_token:string}>(`insert into public.experiment_exposures(
    organization_id,project_id,experiment_id,variant_id,visitor_key_hash,utm,is_bot,tracking_token,entry_hostname)
    values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
    on conflict(experiment_id,visitor_key_hash) do update
      set tracking_token=coalesce(experiment_exposures.tracking_token,excluded.tracking_token)
    returning variant_id,tracking_token`,
  [experiment.organization_id,experiment.project_id,experiment.id,candidate.id,
    visitorHash,JSON.stringify(utm),isBot,trackingToken,hostname])).rows[0];
  const selected=variants.find(item=>item.id===persisted?.variant_id);
  if(!selected)return new NextResponse("Variante indisponível",{status:503});
  const destination=new URL(selected.destination_url);
  for(const [key,value] of Object.entries(utm))if(!destination.searchParams.has(key))destination.searchParams.set(key,value);
  if(persisted?.tracking_token&&!destination.searchParams.has("sck")){
    destination.searchParams.set("sck",persisted.tracking_token);
  }
  const response=NextResponse.redirect(destination,302);
  if(!request.cookies.has(COOKIE))response.cookies.set(COOKIE,visitor,{httpOnly:true,sameSite:"lax",secure:true,
    path:"/",maxAge:60*60*24*365});
  return response;
}
