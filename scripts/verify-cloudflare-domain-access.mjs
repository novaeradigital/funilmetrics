import {createDecipheriv} from "node:crypto";
import pg from "pg";

const databaseUrl=process.env.DATABASE_URL;
const encodedKey=process.env.INTEGRATION_SECRET_ENCRYPTION_KEY;
if(!databaseUrl||!encodedKey)throw new Error("runtime_configuration_missing");
const key=Buffer.from(encodedKey,"base64");
if(key.length!==32)throw new Error("vault_key_invalid");

const pool=new pg.Pool({connectionString:databaseUrl,
 ssl:process.env.DATABASE_SSL_REJECT_UNAUTHORIZED==="false"?
  {rejectUnauthorized:false}:undefined});
const rows=(await pool.query(`
 select project.name as project_name,connection.configuration,
  secret.ciphertext,secret.initialization_vector,secret.authentication_tag
 from public.connections connection
 join public.projects project on project.id=connection.project_id
 join lateral (
  select ciphertext,initialization_vector,authentication_tag
  from public.integration_secrets
  where project_id=connection.project_id and provider='cloudflare_account'
   and kind='credential_bundle' and rotated_at is null
  order by created_at desc limit 1
 ) secret on true
 where connection.provider='cloudflare_account' and connection.status='active'
 order by connection.updated_at desc`)).rows;

for(const row of rows){
 const decipher=createDecipheriv("aes-256-gcm",key,row.initialization_vector);
 decipher.setAuthTag(row.authentication_tag);
 const value=JSON.parse(Buffer.concat([
  decipher.update(row.ciphertext),decipher.final()]).toString("utf8"));
 const token=String(value.apiToken??"");
 const accountId=String(row.configuration.accountId??"");
 const call=async(path)=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{
   headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
  const body=await response.json();
  return {ok:response.ok&&body.success,status:response.status,
   errors:(body.errors??[]).map(item=>({code:item.code,message:item.message})),
   resultStatus:body.result&&typeof body.result==="object"&&!Array.isArray(body.result)?
    body.result.status??null:null};
 };
 const tokenCheck=await call("/user/tokens/verify");
 const zoneCheck=await call(`/zones?account.id=${encodeURIComponent(accountId)}&per_page=1`);
 const workerCheck=await call(`/accounts/${encodeURIComponent(accountId)}/workers/scripts`);
 const domains=(await pool.query(`
  select hostname,cloudflare_zone_id,cloudflare_zone_status,cloudflare_name_servers,
   status::text as local_status
  from public.custom_domains where project_id=(
   select id from public.projects where name=$1 limit 1
  ) and dns_provider='cloudflare_owned' order by created_at desc`,[row.project_name])).rows;
 const domainChecks=[];
 for(const domain of domains){
  const live=await call(`/zones/${encodeURIComponent(domain.cloudflare_zone_id)}`);
  domainChecks.push({hostname:domain.hostname,storedZoneStatus:domain.cloudflare_zone_status,
   localStatus:domain.local_status,nameServers:domain.cloudflare_name_servers,liveZone:live});
 }
 console.log(JSON.stringify({project:row.project_name,configured:Boolean(token&&accountId),
  token:tokenCheck,zoneAccess:zoneCheck,workerAccess:workerCheck,domains:domainChecks}));
}
if(!rows.length)console.log(JSON.stringify({configured:false,reason:"connection_missing"}));
await pool.end();
