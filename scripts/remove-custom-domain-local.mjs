import pg from "pg";

const hostname=String(process.argv[2]??"").trim().toLowerCase();
const confirmation=String(process.argv[3]??"");
if(!hostname||confirmation!==`DELETE:${hostname}`)
 throw new Error("explicit_confirmation_required");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 ssl:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED==="false"?
  {rejectUnauthorized:false}:undefined});
const client=await pool.connect();
try{
 await client.query("begin");
 const row=(await client.query(`
  select id,organization_id,project_id,hostname,dns_provider,
   railway_custom_domain_id,cloudflare_zone_id
  from public.custom_domains where hostname=$1 for update`,[hostname])).rows[0];
 if(!row)throw new Error("domain_not_found");
 await client.query("delete from public.custom_domains where id=$1",[row.id]);
 await client.query(`
  insert into public.audit_logs(organization_id,project_id,action,target_type,
   target_id,reason,before,after)
  values($1,$2,'custom_domain_deleted','custom_domain',$3,
   'operator_requested_panel_removal',$4::jsonb,$5::jsonb)`,[
   row.organization_id,row.project_id,row.id,JSON.stringify({
    hostname:row.hostname,dnsProvider:row.dns_provider,
    railwayCustomDomainId:row.railway_custom_domain_id,
    cloudflareZoneId:row.cloudflare_zone_id}),
   JSON.stringify({deleted:true,externalCleanup:false})]);
 await client.query("commit");
 console.log(JSON.stringify({removed:true,hostname:row.hostname,auditPreserved:true}));
}catch(error){
 await client.query("rollback");throw error;
}finally{
 client.release();await pool.end();
}
