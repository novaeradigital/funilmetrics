import {timingSafeEqual} from "node:crypto";
import type {FastifyInstance} from "fastify";
import type {Pool} from "pg";
import {z} from "zod";

const exposure=z.object({
 organizationId:z.string().uuid(),projectId:z.string().uuid(),
 experimentId:z.string().uuid(),variantId:z.string().uuid(),
 visitorKeyHash:z.string().regex(/^[a-f0-9]{64}$/),
 utm:z.record(z.string(),z.string()).default({}),isBot:z.boolean(),
 trackingToken:z.string().regex(/^fm_[a-f0-9]{32}$/),
 entryHostname:z.string().min(3).max(253),exposedAt:z.string().datetime(),
});
function authorized(value:string|undefined){
 const expected=process.env.EDGE_SHARED_SECRET??"";
 if(!value||!expected)return false;
 const left=Buffer.from(value),right=Buffer.from(expected);
 return left.length===right.length&&timingSafeEqual(left,right);
}
export async function registerEdgeRedirectRoutes(app:FastifyInstance,pool:Pool){
 app.get<{Querystring:{hostname?:string;slug?:string;preview?:string}}>(
  "/edge/experiments/config",async(request,reply)=>{
   if(!authorized(request.headers["x-fm-edge-secret"] as string|undefined))
    return reply.status(401).send({error:"unauthorized"});
   const hostname=String(request.query.hostname??"").toLowerCase();
   const slug=String(request.query.slug??"").toLowerCase();
   if(!hostname||!slug)return reply.status(400).send({error:"invalid_request"});
   const row=(await pool.query<{id:string;organization_id:string;project_id:string}>(
    `select experiment.id,experiment.organization_id,experiment.project_id
       from public.experiments experiment
       join public.custom_domains domain on domain.project_id=experiment.project_id
      where domain.hostname=$1
        and (domain.status='active' or ($3::boolean and domain.verified_at is not null))
        and experiment.slug=$2 and experiment.status='active' limit 1`,
    [hostname,slug,request.query.preview==="1"])).rows[0];
   if(!row)return reply.status(404).send({error:"not_found"});
   const variants=(await pool.query<{id:string;destination_url:string;weight:number}>(
    `select id,destination_url,weight from public.experiment_variants
      where experiment_id=$1 order by position`,[row.id])).rows;
   reply.header("Cache-Control","private,no-store");
   return {id:row.id,organizationId:row.organization_id,projectId:row.project_id,
    variants:variants.map(item=>({id:item.id,destinationUrl:item.destination_url,
     weight:item.weight}))};
  });
 app.post("/edge/exposures",async(request,reply)=>{
  if(!authorized(request.headers["x-fm-edge-secret"] as string|undefined))
   return reply.status(401).send({error:"unauthorized"});
  const parsed=z.array(exposure).min(1).max(100).safeParse(request.body);
  if(!parsed.success)return reply.status(400).send({error:"invalid_payload"});
  const client=await pool.connect();
  try{
   await client.query("begin");
   for(const item of parsed.data){
    await client.query(`insert into public.experiment_exposures(
      organization_id,project_id,experiment_id,variant_id,visitor_key_hash,utm,
      is_bot,tracking_token,entry_hostname,exposed_at)
      values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
      on conflict(experiment_id,visitor_key_hash) do update set
       tracking_token=coalesce(experiment_exposures.tracking_token,excluded.tracking_token)`,
     [item.organizationId,item.projectId,item.experimentId,item.variantId,
      item.visitorKeyHash,JSON.stringify(item.utm),item.isBot,item.trackingToken,
      item.entryHostname,item.exposedAt]);
   }
   await client.query("commit");
  }catch{await client.query("rollback");throw new Error("edge_exposure_persist_failed")}
  finally{client.release()}
  return reply.status(202).send({accepted:parsed.data.length});
 });
}
