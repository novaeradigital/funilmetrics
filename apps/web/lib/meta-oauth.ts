import "server-only";
import type { Pool } from "pg";
import { decryptIntegrationSecret, loadIntegrationVaultKey } from "./integration-vault";

export const metaOAuthRedirectUri =
  "https://web-production-a818d.up.railway.app/dashboard/integracoes/meta/callback";

export async function loadMetaAppConfig(pool:Pool,projectId:string){
  const result=await pool.query<{
    app_id:string; ciphertext:Buffer; initialization_vector:Buffer; authentication_tag:Buffer;
  }>(
    `select connection.configuration->>'appId' as app_id,
            secret.ciphertext,secret.initialization_vector,secret.authentication_tag
       from public.connections connection
       join lateral (
         select ciphertext,initialization_vector,authentication_tag
           from public.integration_secrets
          where project_id=connection.project_id and provider=connection.provider
            and kind='credential_bundle' and rotated_at is null
          order by created_at desc limit 1
       ) secret on true
      where connection.project_id=$1
        and connection.provider in ('meta_ads_app','meta_ads')
        and connection.configuration->>'appId' is not null
      order by case when connection.provider='meta_ads_app' then 0 else 1 end,
               connection.created_at desc limit 1`,
    [projectId],
  );
  const row=result.rows[0], key=loadIntegrationVaultKey();
  if(!row||!key) return null;
  const secret=decryptIntegrationSecret({
    ciphertext:row.ciphertext,initializationVector:row.initialization_vector,
    authenticationTag:row.authentication_tag,
  },key);
  const appSecret=String(secret.appSecret??"");
  return row.app_id&&appSecret?{appId:row.app_id,appSecret}:null;
}

export async function loadMetaConnectionAccessToken(pool:Pool,connectionId:string){
  const result=await pool.query<{
    ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer;
  }>(
    `select s.ciphertext,s.initialization_vector,s.authentication_tag
       from public.connections c
       join public.integration_secrets s on s.project_id=c.project_id
        and s.provider='meta_ads' and s.rotated_at is null
        and (s.kind='oauth_access_token:'||c.id::text
          or (s.kind='credential_bundle' and
              coalesce(c.configuration->>'authorizationMode','system_user')='system_user'))
      where c.id=$1 order by s.created_at desc limit 1`,
    [connectionId],
  );
  const row=result.rows[0],key=loadIntegrationVaultKey();
  if(!row||!key) return null;
  const secret=decryptIntegrationSecret({
    ciphertext:row.ciphertext,initializationVector:row.initialization_vector,
    authenticationTag:row.authentication_tag,
  },key);
  return String(secret.accessToken??"")||null;
}
