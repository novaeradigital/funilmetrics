import type {Pool} from "pg";
import {decryptIntegrationSecret,loadIntegrationVaultKey} from "./integration-vault";

const API="https://api.cloudflare.com/client/v4";

type Envelope<T>={success:boolean;errors?:Array<{code:number;message:string}>;result:T};
type Zone={id:string;name:string;status:string;name_servers:string[]};

async function request<T>(token:string,path:string,init?:RequestInit){
 const response=await fetch(`${API}${path}`,{
  ...init,cache:"no-store",signal:AbortSignal.timeout(20_000),
  headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...init?.headers},
 });
 const body=await response.json() as Envelope<T>;
 if(!response.ok||!body.success)throw new Error(`cloudflare_http_${response.status}`);
 return body.result;
}

export async function loadProjectCloudflareToken(pool:Pool,projectId:string){
 const row=(await pool.query<{ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer}>(
  `select ciphertext,initialization_vector,authentication_tag from public.integration_secrets
   where project_id=$1 and provider='cloudflare_account' and kind='credential_bundle'
   and rotated_at is null order by created_at desc limit 1`,[projectId])).rows[0];
 if(!row)return null;
 const key=loadIntegrationVaultKey();if(!key)return null;
 const secret=decryptIntegrationSecret({ciphertext:row.ciphertext,
  initializationVector:row.initialization_vector,authenticationTag:row.authentication_tag},key);
 return String(secret.apiToken??"")||null;
}

export async function validateCloudflareToken(token:string){
 return request<{id:string;status:string}>(token,"/user/tokens/verify");
}

export async function createOrFindCloudflareZone(token:string,accountId:string,zoneName:string){
 const existing=await request<Zone[]>(token,`/zones?name=${encodeURIComponent(zoneName)}&account.id=${encodeURIComponent(accountId)}`);
 if(existing[0])return existing[0];
 return request<Zone>(token,"/zones",{method:"POST",body:JSON.stringify({
  account:{id:accountId},name:zoneName,type:"full",jump_start:true,
 })});
}

export async function getCloudflareZone(token:string,zoneId:string){
 return request<Zone>(token,`/zones/${zoneId}`);
}

export async function attachWorkerCustomDomain(token:string,accountId:string,input:{
 zoneId:string;zoneName:string;hostname:string;service:string;
}){
 return request<{id:string;hostname:string}>(token,
  `/accounts/${accountId}/workers/scripts/${input.service}/domains/records`,{
   method:"PUT",body:JSON.stringify({environment:"production",hostname:input.hostname,
    service:input.service,zone_id:input.zoneId,zone_name:input.zoneName}),
  });
}

type WorkerDomain={id:string;hostname:string;service:string;zone_id:string};

export async function removeWorkerCustomDomain(token:string,accountId:string,input:{
 hostname:string;service:string;
}){
 const records=await request<WorkerDomain[]>(token,
  `/accounts/${accountId}/workers/domains/records`);
 const record=records.find(item=>item.hostname===input.hostname&&item.service===input.service);
 if(!record)return false;
 await request<unknown>(token,
  `/accounts/${accountId}/workers/domains/records/${record.id}`,{method:"DELETE"});
 return true;
}

export async function removeCloudflareZone(token:string,zoneId:string){
 return request<{id:string}>(token,`/zones/${zoneId}`,{method:"DELETE"});
}
