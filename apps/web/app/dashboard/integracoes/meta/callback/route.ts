import { createHash } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import { encryptIntegrationSecret,loadIntegrationVaultKey } from "../../../../../lib/integration-vault";
import { loadMetaAppConfig,metaOAuthRedirectUri } from "../../../../../lib/meta-oauth";
import { createClient } from "../../../../../lib/supabase/server";
import { getActiveProject } from "../../../../../lib/active-project";

const finish=(request:NextRequest,status:string)=>
  NextResponse.redirect(new URL(`/dashboard/integracoes?status=${status}`,process.env.APP_URL??request.nextUrl.origin));

export async function GET(request:NextRequest){
  const code=request.nextUrl.searchParams.get("code"),state=request.nextUrl.searchParams.get("state");
  if(!code||!state||request.nextUrl.searchParams.get("error")) return finish(request,"meta-oauth-denied");
  const supabase=await createClient(); const {data}=await supabase.auth.getUser();
  if(!data.user) return finish(request,"meta-oauth-invalid");
  const database=getDatabase(),hash=createHash("sha256").update(state).digest("hex");
  const stored=await database.pool.query<{id:string;project_id:string;organization_id:string;requested_by_user_id:string}>(
    `select s.id,s.project_id,s.organization_id,s.requested_by_user_id
     from public.meta_oauth_states s join public.users u on u.id=s.requested_by_user_id
     where s.state_hash=$1 and s.consumed_at is null and s.expires_at>now()
       and u.auth_user_id=$2`,[hash,data.user.id]);
  const oauth=stored.rows[0]; if(!oauth) return finish(request,"meta-oauth-invalid");
  const active=await getActiveProject(data.user.id);
  if(!active.project||active.project.id!==oauth.project_id)
    return finish(request,"forbidden");
  const claimed=await database.pool.query<{id:string}>(
    `update public.meta_oauth_states
        set consumed_at=now()
      where id=$1 and state_hash=$2 and consumed_at is null and expires_at>now()
      returning id`,
    [oauth.id,hash],
  );
  if(!claimed.rows[0]) return finish(request,"meta-oauth-invalid");
  let config:Awaited<ReturnType<typeof loadMetaAppConfig>>;
  let key:ReturnType<typeof loadIntegrationVaultKey>;
  try{
    config=await loadMetaAppConfig(database.pool,oauth.project_id);
    key=loadIntegrationVaultKey();
  }catch{
    return finish(request,"meta-app-not-configured");
  }
  if(!config||!key) return finish(request,"meta-app-not-configured");
  let response:Response;
  try{
    response=await fetch("https://graph.facebook.com/v25.0/oauth/access_token",{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({client_id:config.appId,client_secret:config.appSecret,
        redirect_uri:metaOAuthRedirectUri,code}),cache:"no-store",
      signal:AbortSignal.timeout(15_000)});
  }catch{
    return finish(request,"meta-oauth-exchange-unavailable");
  }
  if(!response.ok) return finish(request,"meta-oauth-exchange-failed");
  let token:{access_token?:string;expires_in?:number};
  try{
    token=await response.json() as typeof token;
  }catch{
    return finish(request,"meta-oauth-exchange-invalid");
  }
  if(!token.access_token) return finish(request,"meta-oauth-exchange-failed");
  let profileResponse:Response;
  try{
    profileResponse=await fetch("https://graph.facebook.com/v25.0/me?fields=id,name",{
      headers:{Authorization:`Bearer ${token.access_token}`},cache:"no-store",
      signal:AbortSignal.timeout(15_000)});
  }catch{
    return finish(request,"meta-oauth-profile-unavailable");
  }
  if(!profileResponse.ok) return finish(request,"meta-oauth-profile-failed");
  let profile:{id?:string;name?:string};
  try{
    profile=await profileResponse.json() as typeof profile;
  }catch{
    return finish(request,"meta-oauth-profile-invalid");
  }
  if(!profile.id) return finish(request,"meta-oauth-profile-failed");
  const encrypted=encryptIntegrationSecret({accessToken:token.access_token},key);
  const client=await database.pool.connect();
  let connectionId="";
  try{
    await client.query("begin");
    const connection=await client.query<{id:string}>(
      `insert into public.connections(organization_id,project_id,provider,name,configuration)
       values($1,$2,'meta_ads',$3,$4::jsonb) returning id`,
      [oauth.organization_id,oauth.project_id,`Meta OAuth - ${profile.name??profile.id}`,
       JSON.stringify({authorizationMode:"oauth_user",appId:config.appId,mode:"preparation_only"})]);
    connectionId=connection.rows[0]!.id;
    await client.query(
      `insert into public.integration_secrets(organization_id,project_id,provider,kind,
       ciphertext,initialization_vector,authentication_tag)
       values($1,$2,'meta_ads',$3,$4,$5,$6)`,
      [oauth.organization_id,oauth.project_id,`oauth_access_token:${connection.rows[0]!.id}`,
       encrypted.ciphertext,encrypted.initializationVector,encrypted.authenticationTag]);
    await client.query(
      `insert into public.meta_authorizations(organization_id,project_id,connection_id,mode,
       external_subject_id,external_subject_name,granted_scopes,token_expires_at,status,last_validated_at)
       values($1,$2,$3,'oauth_user',$4,$5,array['ads_read','business_management'],
       case when $6::int>0 then now()+($6::text||' seconds')::interval else null end,'active',now())`,
      [oauth.organization_id,oauth.project_id,connection.rows[0]!.id,profile.id,profile.name??null,token.expires_in??0]);
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    console.error("meta_oauth_persistence_failed",{
      projectId:oauth.project_id,
      organizationId:oauth.organization_id,
      error:error instanceof Error?error.message:"unknown_error",
    });
    return finish(request,"meta-oauth-save-failed");
  }
  finally{client.release();}
  return NextResponse.redirect(new URL(
    `/dashboard/integracoes/meta/accounts?connectionId=${encodeURIComponent(connectionId)}`,
    process.env.APP_URL??request.nextUrl.origin,
  ));
}
