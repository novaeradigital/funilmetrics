"use server";
import {randomBytes} from "node:crypto";import {resolveTxt} from "node:dns/promises";
import {redirect} from "next/navigation";import {revalidatePath} from "next/cache";
import {createClient} from "../../../lib/supabase/server";import {getActiveProject} from "../../../lib/active-project";
import {getDatabase} from "../../../lib/database";
import {normalizeCustomDomain} from "../../../lib/custom-domain";
import {
 createRailwayCustomDomain,deleteRailwayCustomDomain,loadProjectRailwayConfiguration,
} from "../../../lib/railway-api";
import {inspectCustomDomainHealth} from "../../../lib/custom-domain-health";
import {attachWorkerCustomDomain,createOrFindCloudflareZone,getCloudflareZone,
 loadProjectCloudflareToken,removeCloudflareZone,removeWorkerCustomDomain} from "../../../lib/cloudflare-api";

const zonePattern=/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

async function scope(){
 const supabase=await createClient(),{data}=await supabase.auth.getUser();if(!data.user)redirect("/login");
 const {project}=await getActiveProject(data.user.id);if(!project)redirect("/dashboard/projetos");
 if(!["owner","administrator"].includes(project.role))redirect("/dashboard/dominios?status=forbidden");
 const db=getDatabase(),actor=(await db.pool.query<{id:string}>(
  "select id from public.users where auth_user_id=$1",[data.user.id])).rows[0];
 if(!actor)redirect("/dashboard/dominios?status=forbidden");
 return {project,db,actor};
}
export async function createCustomDomain(formData:FormData){
 const hostname=normalizeCustomDomain(String(formData.get("hostname")??""));if(!hostname)
  redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope(),token=randomBytes(24).toString("hex");
 try{
  const row=(await db.pool.query<{id:string}>(`insert into public.custom_domains(
   organization_id,project_id,hostname,verification_token,created_by_user_id)
   values($1,$2,$3,$4,$5) returning id`,
   [project.organization_id,project.id,hostname,token,actor.id])).rows[0]!;
  await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'custom_domain_created',
   'custom_domain',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,row.id,
    JSON.stringify({hostname,status:"pending_dns"})]);
 }catch{redirect("/dashboard/dominios?status=create-failed")}
 revalidatePath("/dashboard/dominios");redirect("/dashboard/dominios?status=created");
}

export async function createOwnedCloudflareDomain(formData:FormData){
 const zoneName=normalizeCustomDomain(String(formData.get("zone_name")??""));
 const hostname=normalizeCustomDomain(String(formData.get("hostname")??""));
 if(!zoneName||!hostname||!zonePattern.test(zoneName)||hostname===zoneName||
  !hostname.endsWith(`.${zoneName}`))redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope();
 const connection=(await db.pool.query<{configuration:Record<string,unknown>}>(
  `select configuration from public.connections where project_id=$1
   and provider='cloudflare_account' and status='active'
   order by created_at desc limit 1`,[project.id])).rows[0];
 const accountId=String(connection?.configuration.accountId??"");
 const token=await loadProjectCloudflareToken(db.pool,project.id);
 if(!token||!/^[0-9a-f]{32}$/i.test(accountId))
  redirect("/dashboard/dominios?status=cloudflare-not-configured");
 let zone;
 try{zone=await createOrFindCloudflareZone(token,accountId,zoneName);}
 catch{redirect("/dashboard/dominios?status=cloudflare-zone-failed");}
 const client=await db.pool.connect();try{
  await client.query("begin");
  const row=(await client.query<{id:string}>(`insert into public.custom_domains(
   organization_id,project_id,hostname,verification_token,created_by_user_id,
   dns_provider,cloudflare_zone_id,cloudflare_zone_name,cloudflare_zone_status,
   cloudflare_name_servers,cloudflare_checked_at)
   values($1,$2,$3,$4,$5,'cloudflare_owned',$6,$7,$8,$9::jsonb,now())
   on conflict(hostname) do nothing returning id`,[
    project.organization_id,project.id,hostname,randomBytes(24).toString("hex"),actor.id,
    zone.id,zone.name,zone.status,JSON.stringify(zone.name_servers??[])] )).rows[0];
  if(!row)throw new Error("duplicate");
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,after) values($1,$2,$3,'cloudflare_zone_created',
   'custom_domain',$4,$5::jsonb)`,[project.organization_id,project.id,actor.id,row.id,
    JSON.stringify({hostname,zoneName,zoneId:zone.id,status:zone.status,
     nameServers:zone.name_servers??[]})]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/dominios?status=create-failed")}
 finally{client.release()}
 revalidatePath("/dashboard/dominios");redirect("/dashboard/dominios?status=cloudflare-zone-created");
}

export async function refreshOwnedCloudflareDomain(formData:FormData){
 const id=String(formData.get("domain_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope();
 const domain=(await db.pool.query<{hostname:string;cloudflare_zone_id:string;
  cloudflare_zone_name:string;status:string}>(`select hostname,cloudflare_zone_id,
  cloudflare_zone_name,status::text from public.custom_domains where id=$1 and project_id=$2
  and dns_provider='cloudflare_owned'`,[id,project.id])).rows[0];
 if(!domain)redirect("/dashboard/dominios?status=not-found");
 const connection=(await db.pool.query<{configuration:Record<string,unknown>}>(
  `select configuration from public.connections where project_id=$1 and provider='cloudflare_account'
   and status='active' order by created_at desc limit 1`,[project.id])).rows[0];
 const token=await loadProjectCloudflareToken(db.pool,project.id);
 const accountId=String(connection?.configuration.accountId??"");
 if(!token||!accountId)redirect("/dashboard/dominios?status=cloudflare-not-configured");
 let outcome:"activated"|"nameservers-pending"="nameservers-pending";
 try{
  const zone=await getCloudflareZone(token,domain.cloudflare_zone_id);
  let nextStatus=domain.status,certificateStatus="PENDING";
  if(zone.status==="active"){
   await attachWorkerCustomDomain(token,accountId,{zoneId:zone.id,zoneName:zone.name,
    hostname:domain.hostname,service:"funil-metrics-redirect"});
   nextStatus="active";certificateStatus="ACTIVE";
  }
  await db.pool.query(`update public.custom_domains set cloudflare_zone_status=$1,
   cloudflare_name_servers=$2::jsonb,cloudflare_checked_at=now(),
   status=$3::text::public.custom_domain_status,certificate_status=$4,
   activated_at=case when $3='active' then coalesce(activated_at,now()) else activated_at end,
   last_error_code=null,updated_at=now() where id=$5 and project_id=$6`,[
    zone.status,JSON.stringify(zone.name_servers??[]),nextStatus,certificateStatus,id,project.id]);
  await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,before,after) values($1,$2,$3,$4,'custom_domain',$5,$6::jsonb,$7::jsonb)`,[
    project.organization_id,project.id,actor.id,nextStatus==="active"?
     "cloudflare_domain_activated":"cloudflare_zone_status_checked",id,
    JSON.stringify({status:domain.status}),JSON.stringify({status:nextStatus,zoneStatus:zone.status})]);
  outcome=nextStatus==="active"?"activated":"nameservers-pending";
 }catch(error){
  console.error("cloudflare_domain_refresh_failed",{code:error instanceof Error?error.message:"unknown"});
  redirect("/dashboard/dominios?status=cloudflare-provisioning-failed");
 }
 revalidatePath("/dashboard/dominios");
 redirect(`/dashboard/dominios?status=${outcome}`);
}
export async function verifyCustomDomain(formData:FormData){
 const id=String(formData.get("domain_id")??"");if(!/^[0-9a-f-]{36}$/i.test(id))
  redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope(),domain=(await db.pool.query<{
  id:string;hostname:string;verification_token:string;status:string}>(`select id,hostname,
   verification_token,status::text from public.custom_domains where id=$1 and project_id=$2`,
   [id,project.id])).rows[0];
 if(!domain)redirect("/dashboard/dominios?status=not-found");
 const expected=`funil-metrics-verification=${domain.verification_token}`;
 let verified=false;try{
  const records=await resolveTxt(`_funil-metrics.${domain.hostname}`);
  verified=records.some(parts=>parts.join("")===expected);
 }catch{}
 await db.pool.query(`update public.custom_domains
  set status=$1::text::public.custom_domain_status,verification_checked_at=now(),
  verified_at=case when $1::text='verified' then coalesce(verified_at,now()) else verified_at end,
  last_error_code=case when $1::text='verified' then null else 'dns_txt_missing' end,updated_at=now()
  where id=$2 and project_id=$3`,[verified?"verified":"pending_dns",id,project.id]);
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
  action,target_type,target_id,before,after) values($1,$2,$3,$4,'custom_domain',$5,$6::jsonb,$7::jsonb)`,
  [project.organization_id,project.id,actor.id,verified?"custom_domain_verified":"custom_domain_verification_failed",
   id,JSON.stringify({status:domain.status}),JSON.stringify({status:verified?"verified":"pending_dns"})]);
 revalidatePath("/dashboard/dominios");redirect(`/dashboard/dominios?status=${verified?"verified":"dns-missing"}`);
}
export async function updateProvisioningRequest(formData:FormData){
 const id=String(formData.get("domain_id")??""),intent=String(formData.get("intent")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!["request","cancel"].includes(intent))
  redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope();
 const domain=(await db.pool.query<{id:string;hostname:string;status:string;
  railway_custom_domain_id:string|null}>(`select id,hostname,status::text,
  railway_custom_domain_id from public.custom_domains where id=$1 and project_id=$2`,
  [id,project.id])).rows[0];
 if(!domain)redirect("/dashboard/dominios?status=not-found");
 if(intent==="cancel"){
  if(domain.status!=="provisioning"||domain.railway_custom_domain_id)
   redirect("/dashboard/dominios?status=cancel-unavailable");
  await db.pool.query(`update public.custom_domains set
   status='verified'::public.custom_domain_status,provisioning_requested_at=null,
   provisioning_requested_by_user_id=null,updated_at=now()
   where id=$1 and project_id=$2`,[id,project.id]);
  await db.pool.query(`insert into public.audit_logs(organization_id,project_id,
   actor_user_id,action,target_type,target_id,before,after)
   values($1,$2,$3,'custom_domain_provisioning_cancelled','custom_domain',$4,
   '{"status":"provisioning"}'::jsonb,'{"status":"verified"}'::jsonb)`,
   [project.organization_id,project.id,actor.id,id]);
  revalidatePath("/dashboard/dominios");
  redirect("/dashboard/dominios?status=provisioning-cancelled");
 }
 if(domain.status!=="verified")redirect("/dashboard/dominios?status=invalid-state");
 const configuration=await loadProjectRailwayConfiguration(db.pool,project.id);
 if(!configuration)redirect("/dashboard/dominios?status=railway-not-configured");
 let provisioned;
 try{provisioned=await createRailwayCustomDomain(configuration,domain.hostname);}
 catch{redirect("/dashboard/dominios?status=provider-provisioning-failed");}
 const traffic=provisioned.status.dnsRecords.find(record=>
  record.purpose==="DNS_RECORD_PURPOSE_TRAFFIC_ROUTE")??provisioned.status.dnsRecords[0];
 if(!traffic)redirect("/dashboard/dominios?status=provider-response-invalid");
 const client=await db.pool.connect();try{
  await client.query("begin");
  await client.query(`update public.custom_domains set
   status='provisioning'::public.custom_domain_status,
   railway_custom_domain_id=$1,traffic_dns_type=$2,traffic_dns_host=$3,
   traffic_dns_value=$4,provider_verification_dns_host=$5,
   provider_verification_dns_value=$6,certificate_status=$7,
   provisioning_requested_at=now(),provisioning_requested_by_user_id=$8,
   provisioned_at=now(),last_error_code=null,updated_at=now()
   where id=$9 and project_id=$10`,[
    provisioned.id,traffic.recordType.replace("DNS_RECORD_TYPE_",""),
    traffic.hostlabel,traffic.requiredValue,
    provisioned.status.verificationDnsHost,provisioned.status.verificationToken,
    provisioned.status.certificateStatus,actor.id,id,project.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,
   actor_user_id,action,target_type,target_id,before,after)
   values($1,$2,$3,'custom_domain_provisioned','custom_domain',$4,
   '{"status":"verified"}'::jsonb,$5::jsonb)`,[
    project.organization_id,project.id,actor.id,id,JSON.stringify({
     status:"provisioning",provider:"railway",
     railwayCustomDomainId:provisioned.id,
     trafficDnsType:traffic.recordType,trafficDnsHost:traffic.hostlabel,
     trafficDnsValue:traffic.requiredValue,
     certificateStatus:provisioned.status.certificateStatus,
    })]);
  await client.query("commit");
 }catch{await client.query("rollback");redirect("/dashboard/dominios?status=provisioning-save-failed")}
 finally{client.release()}
 revalidatePath("/dashboard/dominios");
 redirect("/dashboard/dominios?status=provisioning-requested");
}

export async function refreshCustomDomainHealth(formData:FormData){
 const id=String(formData.get("domain_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope();
 const domain=(await db.pool.query<{hostname:string;status:string;
  traffic_dns_value:string|null;provider_verification_dns_host:string|null;
  provider_verification_dns_value:string|null}>(`select hostname,status::text,
  traffic_dns_value,provider_verification_dns_host,provider_verification_dns_value
  from public.custom_domains where id=$1 and project_id=$2`,[id,project.id])).rows[0];
 if(!domain?.traffic_dns_value)redirect("/dashboard/dominios?status=not-provisioned");
 const health=await inspectCustomDomainHealth({
  hostname:domain.hostname,trafficDnsValue:domain.traffic_dns_value,
  providerVerificationDnsHost:domain.provider_verification_dns_host,
  providerVerificationDnsValue:domain.provider_verification_dns_value,
 });
 const active=health.routeReady&&health.providerOwnershipReady&&health.httpsReady;
 await db.pool.query(`update public.custom_domains set
  status=$1::text::public.custom_domain_status,
  activated_at=case when $1::text='active' then coalesce(activated_at,now()) else activated_at end,
  certificate_status=$2,last_health_checked_at=now(),
  last_error_code=case when $1::text='active' then null
   when not $3::boolean then 'traffic_dns_missing'
   when not $4::boolean then 'provider_dns_missing'
   else 'tls_pending' end,updated_at=now()
  where id=$5 and project_id=$6`,[
   active?"active":"provisioning",active?"VALID":"PENDING",
   health.routeReady,health.providerOwnershipReady,id,project.id]);
 await db.pool.query(`insert into public.audit_logs(organization_id,project_id,
  actor_user_id,action,target_type,target_id,before,after)
  values($1,$2,$3,$4,'custom_domain',$5,$6::jsonb,$7::jsonb)`,[
   project.organization_id,project.id,actor.id,
   active?"custom_domain_activated":"custom_domain_health_checked",id,
   JSON.stringify({status:domain.status}),JSON.stringify({status:active?"active":"provisioning",...health})]);
 revalidatePath("/dashboard/dominios");
 redirect(`/dashboard/dominios?status=${active?"activated":"activation-pending"}`);
}

export async function updateCustomDomainAvailability(formData:FormData){
 const id=String(formData.get("domain_id")??""),intent=String(formData.get("intent")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!["disable","restore"].includes(intent))
  redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope(),client=await db.pool.connect();
 try{
  await client.query("begin");
  const domain=(await client.query<{status:string;verified_at:Date|null}>(`select status::text,verified_at
   from public.custom_domains where id=$1 and project_id=$2 for update`,[id,project.id])).rows[0];
  if(!domain)throw new Error("not_found");
  const next=intent==="disable"?"disabled":domain.verified_at?"verified":"pending_dns";
  if((intent==="disable"&&domain.status==="disabled")||(intent==="restore"&&domain.status!=="disabled"))
   throw new Error("invalid_state");
  await client.query(`update public.custom_domains
   set status=$1::text::public.custom_domain_status,
   disabled_at=case when $2::text='disable' then now() else null end,
   disabled_by_user_id=case when $2::text='disable' then $3::uuid else null end,
   provisioning_requested_at=null,provisioning_requested_by_user_id=null,updated_at=now()
   where id=$4 and project_id=$5`,[next,intent,actor.id,id,project.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,before,after) values($1,$2,$3,$4,'custom_domain',$5,$6::jsonb,$7::jsonb)`,
   [project.organization_id,project.id,actor.id,
    intent==="disable"?"custom_domain_disabled":"custom_domain_restored",id,
    JSON.stringify({status:domain.status}),JSON.stringify({status:next})]);
  await client.query("commit");
 }catch{
  await client.query("rollback");
  redirect("/dashboard/dominios?status=availability-failed");
 }finally{
  client.release();
 }
 revalidatePath("/dashboard/dominios");
 redirect(`/dashboard/dominios?status=${intent==="disable"?"disabled":"restored"}`);
}

export async function rotateCustomDomainVerification(formData:FormData){
 const id=String(formData.get("domain_id")??"");
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect("/dashboard/dominios?status=invalid");
 const {project,db,actor}=await scope(),client=await db.pool.connect();
 try{
  await client.query("begin");
  const domain=(await client.query<{status:string}>(`select status::text from public.custom_domains
   where id=$1 and project_id=$2 for update`,[id,project.id])).rows[0];
  if(!domain||["active","provisioning"].includes(domain.status))throw new Error("invalid_state");
  const nextStatus=domain.status==="disabled"?"disabled":"pending_dns";
  const nextToken=randomBytes(24).toString("hex");
  await client.query(`update public.custom_domains set verification_token=$1,
   status=$2::text::public.custom_domain_status,
   verified_at=null,verification_checked_at=null,last_error_code=null,updated_at=now()
   where id=$3 and project_id=$4`,[nextToken,nextStatus,id,project.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
   action,target_type,target_id,before,after) values($1,$2,$3,'custom_domain_verification_rotated',
   'custom_domain',$4,$5::jsonb,$6::jsonb)`,[project.organization_id,project.id,actor.id,id,
    JSON.stringify({status:domain.status,verification_token_rotated:false}),
    JSON.stringify({status:nextStatus,verification_token_rotated:true})]);
  await client.query("commit");
 }catch{
  await client.query("rollback");
  redirect("/dashboard/dominios?status=rotation-failed");
 }finally{
  client.release();
 }
 revalidatePath("/dashboard/dominios");
 redirect("/dashboard/dominios?status=verification-rotated");
}

export async function deleteCustomDomain(formData:FormData){
 const id=String(formData.get("domain_id")??"");
 const confirmation=normalizeCustomDomain(String(formData.get("confirmation")??""));
 const removeZone=String(formData.get("remove_zone")??"")==="yes";
 if(!/^[0-9a-f-]{36}$/i.test(id)||!confirmation)
  redirect("/dashboard/dominios?status=delete-confirmation-invalid");
 const {project,db,actor}=await scope();
 const domain=(await db.pool.query<{hostname:string;dns_provider:string;
  cloudflare_zone_id:string|null;cloudflare_zone_name:string|null;
  railway_custom_domain_id:string|null}>(
  `select hostname,dns_provider,cloudflare_zone_id,cloudflare_zone_name,
   railway_custom_domain_id
   from public.custom_domains where id=$1 and project_id=$2`,[id,project.id])).rows[0];
 if(!domain)redirect("/dashboard/dominios?status=not-found");
 if(confirmation!==domain.hostname)
  redirect("/dashboard/dominios?status=delete-confirmation-invalid");
 let zoneUsage=0;
 if(domain.cloudflare_zone_id){
  zoneUsage=Number((await db.pool.query<{count:string}>(
   `select count(*)::text as count from public.custom_domains
    where cloudflare_zone_id=$1`,[domain.cloudflare_zone_id])).rows[0]?.count??0);
 }
 if(removeZone&&zoneUsage>1)redirect("/dashboard/dominios?status=zone-in-use");
 if(domain.dns_provider==="cloudflare_owned"){
  const connection=(await db.pool.query<{configuration:Record<string,unknown>}>(
   `select configuration from public.connections where project_id=$1
    and provider='cloudflare_account' and status='active'
    order by created_at desc limit 1`,[project.id])).rows[0];
  const accountId=String(connection?.configuration.accountId??"");
  const token=await loadProjectCloudflareToken(db.pool,project.id);
  if(!token||!accountId)redirect("/dashboard/dominios?status=cloudflare-not-configured");
  try{
   await removeWorkerCustomDomain(token,accountId,{
    hostname:domain.hostname,service:"funil-metrics-redirect"});
   if(removeZone&&domain.cloudflare_zone_id)
    await removeCloudflareZone(token,domain.cloudflare_zone_id);
  }catch(error){
   console.error("cloudflare_domain_delete_failed",{
    code:error instanceof Error?error.message:"unknown"});
   redirect("/dashboard/dominios?status=external-delete-failed");
  }
 }else if(domain.railway_custom_domain_id){
  const railway=await loadProjectRailwayConfiguration(db.pool,project.id);
  if(!railway)redirect("/dashboard/dominios?status=railway-not-configured");
  try{
   await deleteRailwayCustomDomain(railway,domain.railway_custom_domain_id);
  }catch(error){
   console.error("railway_domain_delete_failed",{
    code:error instanceof Error?error.message:"unknown"});
   redirect("/dashboard/dominios?status=external-delete-failed");
  }
 }
 const client=await db.pool.connect();try{
  await client.query("begin");
  await client.query(`delete from public.custom_domains where id=$1 and project_id=$2`,
   [id,project.id]);
  await client.query(`insert into public.audit_logs(organization_id,project_id,
   actor_user_id,action,target_type,target_id,before,after)
   values($1,$2,$3,'custom_domain_deleted','custom_domain',$4,$5::jsonb,$6::jsonb)`,[
    project.organization_id,project.id,actor.id,id,
    JSON.stringify({hostname:domain.hostname,dnsProvider:domain.dns_provider,
     zoneId:domain.cloudflare_zone_id,zoneName:domain.cloudflare_zone_name}),
    JSON.stringify({deleted:true,cloudflareZoneDeleted:removeZone})]);
  await client.query("commit");
 }catch{
  await client.query("rollback");
  redirect("/dashboard/dominios?status=delete-failed");
 }finally{client.release()}
 revalidatePath("/dashboard/dominios");
 redirect("/dashboard/dominios?status=deleted");
}
