"use server";

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  encryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "../../../lib/integration-vault";
import { getDatabase } from "../../../lib/database";
import { createClient } from "../../../lib/supabase/server";
import { checkClamAvConnection } from "../../../lib/clamav-check";
import {
  createR2PreviewClient,
  loadProjectR2PreviewConfig,
} from "../../../lib/r2-preview";
import { loadMetaConnectionAccessToken } from "../../../lib/meta-oauth";
import { getActiveProject } from "../../../lib/active-project";
import { validateRailwayToken } from "../../../lib/railway-api";
import {validateCloudflareToken} from "../../../lib/cloudflare-api";

const supported = new Set([
  "openai",
  "cloudflare_r2",
  "clamav",
  "google_drive_app",
  "meta_ads",
  "meta_ads_app",
  "railway",
  "cloudflare_account",
]);

function field(formData: FormData, name: string, max = 2000) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireActiveIntegrationProject(
  authUserId: string,
  projectId: string,
) {
  const active = await getActiveProject(authUserId);
  if (!active.project || active.project.id !== projectId) {
    redirect("/dashboard/integracoes?status=forbidden");
  }
}

export async function saveIntegrationConfiguration(formData: FormData) {
  const provider = field(formData, "provider", 50);
  const projectId = field(formData, "project_id", 64);
  if (!supported.has(provider) || !projectId) redirect("/dashboard/integracoes?status=invalid");
  let key: Buffer | null = null;
  try {
    key = loadIntegrationVaultKey();
  } catch {
    redirect("/dashboard/integracoes?status=vault-disabled");
  }
  if (!key) redirect("/dashboard/integracoes?status=vault-disabled");

  const configuration: Record<string, string | number> = {};
  const secrets: Record<string, string> = {};
  if (provider === "google_drive_app") {
    const clientId = field(formData, "client_id", 500);
    const clientSecret = field(formData, "client_secret", 500);
    const pickerApiKey = field(formData, "picker_api_key", 500);
    const projectNumber = field(formData, "project_number", 40);
    if (
      !clientId.endsWith(".apps.googleusercontent.com") ||
      !clientSecret ||
      !pickerApiKey ||
      !/^\d+$/.test(projectNumber)
    ) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    secrets.clientId = clientId;
    secrets.clientSecret = clientSecret;
    secrets.pickerApiKey = pickerApiKey;
    configuration.projectNumber = projectNumber;
    configuration.redirectUri =
      "https://web-production-a818d.up.railway.app/dashboard/integracoes/google-drive/callback";
    configuration.scope = "drive.readonly";
  } else if (provider === "meta_ads_app") {
    const appSecret = field(formData, "app_secret", 500);
    const appId = field(formData, "app_id", 100);
    if (!appSecret || !/^\d+$/.test(appId)) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    secrets.appSecret = appSecret;
    configuration.appId = appId;
    configuration.authorizationMode = "oauth_app";
    configuration.redirectUri =
      "https://web-production-a818d.up.railway.app/dashboard/integracoes/meta/callback";
    configuration.scopes = "ads_read,business_management";
  } else if (provider === "meta_ads") {
    const accessToken = field(formData, "access_token", 1000);
    const appSecret = field(formData, "app_secret", 500);
    const appId = field(formData, "app_id", 100);
    const businessId = field(formData, "business_id", 100);
    const adAccounts = field(formData, "ad_account_allowlist", 2000)
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (!accessToken || !appSecret || !/^\d+$/.test(appId) || !/^\d+$/.test(businessId) ||
        !adAccounts.length || adAccounts.some((id) => !/^(act_)?\d+$/.test(id))) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    secrets.accessToken = accessToken;
    secrets.appSecret = appSecret;
    configuration.appId = appId;
    configuration.businessId = businessId;
    configuration.adAccountAllowlist = adAccounts
      .map((id) => id.startsWith("act_") ? id : `act_${id}`).join(",");
    configuration.authorizationMode = "system_user";
    configuration.mode = "preparation_only";
  } else if (provider === "openai") {
    const apiKey = field(formData, "api_key", 500);
    const analysisModel = field(formData, "analysis_model", 120);
    const transcriptionModel = field(formData, "transcription_model", 120);
    const monthlyBudget = Number(field(formData, "monthly_budget_brl", 20));
    if (!apiKey.startsWith("sk-") || !analysisModel || !transcriptionModel ||
        !Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    secrets.apiKey = apiKey;
    configuration.analysisModel = analysisModel;
    configuration.transcriptionModel = transcriptionModel;
    configuration.monthlyBudgetBrl = monthlyBudget;
  } else if (provider === "cloudflare_r2") {
    const accountId = field(formData, "account_id", 200);
    const bucket = field(formData, "bucket", 200);
    const accessKeyId = field(formData, "access_key_id", 500);
    const secretAccessKey = field(formData, "secret_access_key", 500);
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    configuration.accountId = accountId;
    configuration.bucket = bucket;
    secrets.accessKeyId = accessKeyId;
    secrets.secretAccessKey = secretAccessKey;
  } else if (provider === "railway") {
    const apiToken = field(formData, "api_token", 1000);
    const railwayProjectId = field(formData, "railway_project_id", 64);
    const environmentId = field(formData, "railway_environment_id", 64);
    const serviceId = field(formData, "railway_service_id", 64);
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!apiToken || !uuid.test(railwayProjectId) ||
        !uuid.test(environmentId) || !uuid.test(serviceId)) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    secrets.apiToken = apiToken;
    configuration.projectId = railwayProjectId;
    configuration.environmentId = environmentId;
    configuration.serviceId = serviceId;
  } else if(provider==="cloudflare_account"){
    const apiToken=field(formData,"api_token",1000);
    const accountId=field(formData,"account_id",64);
    if(!apiToken||!/^[0-9a-f]{32}$/i.test(accountId))
      redirect("/dashboard/integracoes?status=invalid");
    secrets.apiToken=apiToken;configuration.accountId=accountId;
  } else {
    const host = field(formData, "host", 255);
    const port = Number(field(formData, "port", 10));
    if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
      redirect("/dashboard/integracoes?status=invalid");
    }
    configuration.host = host;
    configuration.port = port;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveIntegrationProject(data.user.id, projectId);
  const database = getDatabase();
  const scope = await database.pool.query<{
    organization_id: string;
    actor_user_id: string;
  }>(
    `select project.organization_id, app_user.id as actor_user_id
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
      where project.id = $2 and app_user.status = 'active'
        and coalesce((select p.role_override from public.project_memberships p
          where p.membership_id=membership.id and p.project_id=project.id),
          membership.role) in ('owner', 'administrator')
        and (
          not exists (select 1 from public.project_memberships p
            where p.membership_id = membership.id)
          or exists (select 1 from public.project_memberships p
            where p.membership_id = membership.id and p.project_id = project.id
              and coalesce(p.role_override, membership.role)
                  in ('owner', 'administrator'))
        ) limit 1`,
    [data.user.id, projectId],
  );
  const authorized = scope.rows[0];
  if (!authorized) redirect("/dashboard/integracoes?status=forbidden");
  const encrypted =
    Object.keys(secrets).length > 0
      ? encryptIntegrationSecret(secrets, key)
      : null;
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string; configuration: unknown }>(
      `select id, configuration from public.connections
        where project_id = $1 and provider = $2
        order by created_at desc limit 1 for update`,
      [projectId, provider],
    );
    const connection = existing.rows[0]
      ? await client.query<{ id: string }>(
          `update public.connections set configuration = $1::jsonb,
             status = 'active', updated_at = now() where id = $2 returning id`,
          [JSON.stringify(configuration), existing.rows[0].id],
        )
      : await client.query<{ id: string }>(
          `insert into public.connections (
             organization_id, project_id, provider, name, configuration
           ) values ($1, $2, $3, $4, $5::jsonb) returning id`,
          [
            authorized.organization_id,
            projectId,
            provider,
            provider === "google_drive_app"
              ? "Google Drive OAuth"
              : provider === "meta_ads_app"
                ? "Meta OAuth App"
              : provider === "meta_ads"
                ? "Meta Ads · usuário do sistema"
              : provider === "openai"
                ? "OpenAI"
                : provider === "cloudflare_r2"
                  ? "Cloudflare R2"
                  : provider === "railway"
                    ? "Railway"
                    : provider === "cloudflare_account"
                      ? "Cloudflare · domínios"
                    : "ClamAV",
            JSON.stringify(configuration),
          ],
        );
    if (encrypted) {
      await client.query(
        `update public.integration_secrets set rotated_at = now()
          where project_id = $1 and provider = $2
            and kind = 'credential_bundle' and rotated_at is null`,
        [projectId, provider],
      );
      await client.query(
        `insert into public.integration_secrets (
           organization_id, project_id, provider, kind, ciphertext,
           initialization_vector, authentication_tag
         ) values ($1, $2, $3, 'credential_bundle', $4, $5, $6)`,
        [
          authorized.organization_id,
          projectId,
          provider,
          encrypted.ciphertext,
          encrypted.initializationVector,
          encrypted.authenticationTag,
        ],
      );
    }
    if (provider === "meta_ads") {
      await client.query(
        `insert into public.meta_authorizations (
           organization_id,project_id,connection_id,mode,
           external_business_id,status,updated_at
         ) values ($1,$2,$3,'system_user',$4,'pending',now())
         on conflict (connection_id) do update set
           mode='system_user',external_business_id=excluded.external_business_id,
           status='pending',revoked_at=null,updated_at=now()`,
        [authorized.organization_id,projectId,connection.rows[0]!.id,
         String(configuration.businessId)],
      );
    }
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, before, after
       ) values ($1, $2, $3, 'integration_configuration_updated',
                 'connection', $4, $5::jsonb, $6::jsonb)`,
      [
        authorized.organization_id,
        projectId,
        authorized.actor_user_id,
        connection.rows[0]!.id,
        JSON.stringify(existing.rows[0]?.configuration ?? null),
        JSON.stringify({ provider, configuration, secretReplaced: Boolean(encrypted) }),
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    const databaseError =
      error && typeof error === "object"
        ? {
            code: "code" in error ? String(error.code) : "unknown",
            constraint:
              "constraint" in error ? String(error.constraint) : undefined,
          }
        : { code: "unknown" };
    console.error("integration_configuration_save_failed", databaseError);
    redirect("/dashboard/integracoes?status=save-failed");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/integracoes");
  redirect("/dashboard/integracoes?status=saved");
}

export async function updateOpenAiBudget(formData: FormData) {
  const projectId = field(formData, "project_id", 64);
  const monthlyBudget = Number(field(formData, "monthly_budget_brl", 20));
  if (!projectId || !Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
    redirect("/dashboard/integracoes?status=invalid-budget");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveIntegrationProject(data.user.id, projectId);
  const database = getDatabase();
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const authorized = (
      await client.query<{
        organization_id: string;
        actor_user_id: string;
        connection_id: string;
        configuration: Record<string, unknown>;
      }>(
        `select project.organization_id, app_user.id actor_user_id,
                connection.id connection_id, connection.configuration
           from public.projects project
           join public.users app_user on app_user.auth_user_id = $1
           join public.memberships membership
             on membership.organization_id = project.organization_id
            and membership.user_id = app_user.id
           join public.connections connection
             on connection.project_id = project.id
            and connection.provider = 'openai'
          where project.id = $2
            and app_user.status = 'active'
            and coalesce((select p.role_override from public.project_memberships p
              where p.membership_id=membership.id and p.project_id=project.id),
              membership.role) in ('owner', 'administrator')
            and (
              not exists (select 1 from public.project_memberships p
                where p.membership_id = membership.id)
              or exists (select 1 from public.project_memberships p
                where p.membership_id = membership.id
                  and p.project_id = project.id
                  and coalesce(p.role_override, membership.role)
                      in ('owner', 'administrator'))
            )
          order by connection.created_at desc limit 1 for update`,
        [data.user.id, projectId],
      )
    ).rows[0];
    if (!authorized) {
      await client.query("rollback");
      redirect("/dashboard/integracoes?status=forbidden");
    }
    const before = authorized.configuration;
    const after = { ...before, monthlyBudgetBrl: monthlyBudget };
    await client.query(
      `update public.connections
          set configuration = $1::jsonb, updated_at = now()
        where id = $2`,
      [JSON.stringify(after), authorized.connection_id],
    );
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, before, after
       ) values ($1,$2,$3,'ai_monthly_budget_updated',
                 'connection',$4,$5::jsonb,$6::jsonb)`,
      [
        authorized.organization_id,
        projectId,
        authorized.actor_user_id,
        authorized.connection_id,
        JSON.stringify({ monthlyBudgetBrl: before.monthlyBudgetBrl ?? null }),
        JSON.stringify({ monthlyBudgetBrl: monthlyBudget }),
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.error("ai_monthly_budget_update_failed", {
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
    });
    redirect("/dashboard/integracoes?status=budget-save-failed");
  } finally {
    client.release();
  }
  revalidatePath("/dashboard/integracoes");
  redirect("/dashboard/integracoes?status=budget-saved");
}

export async function saveAiPricing(formData:FormData){
  const projectId=field(formData,"project_id",64);
  const operation=field(formData,"operation",40);
  const model=field(formData,"model",120);
  const source=field(formData,"source_reference",500);
  const input=Number(field(formData,"input_cost_per_million_brl",30)||0);
  const output=Number(field(formData,"output_cost_per_million_brl",30)||0);
  const audio=Number(field(formData,"audio_cost_per_minute_brl",30)||0);
  if(!projectId||!model||!["creative_analysis","creative_transcription"].includes(operation)||
    [input,output,audio].some((value)=>!Number.isFinite(value)||value<0)||
    (operation==="creative_analysis"&&input===0&&output===0)||
    (operation==="creative_transcription"&&audio===0)){
    redirect("/dashboard/integracoes?status=invalid-pricing");
  }
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user) redirect("/login");
  await requireActiveIntegrationProject(data.user.id,projectId);
  const database=getDatabase();
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{organization_id:string;actor_user_id:string}>(
      `select project.organization_id,app_user.id actor_user_id
       from public.projects project join public.users app_user on app_user.auth_user_id=$1
       join public.memberships membership on membership.organization_id=project.organization_id
        and membership.user_id=app_user.id
       where project.id=$2 and app_user.status='active'
        and coalesce((select allowed.role_override
          from public.project_memberships allowed
          where allowed.membership_id=membership.id
            and allowed.project_id=project.id),membership.role)
            in ('owner','administrator') limit 1`,
      [data.user.id,projectId])).rows[0];
    if(!scope){await client.query("rollback");redirect("/dashboard/integracoes?status=forbidden");}
    const previous=await client.query<{id:string}>(
      `update public.ai_project_pricing_versions set valid_until=now()
       where project_id=$1 and model=$2 and operation=$3 and valid_until is null
       returning id`,[projectId,model,operation]);
    const created=(await client.query<{id:string}>(
      `insert into public.ai_project_pricing_versions(
       organization_id,project_id,model,operation,input_cost_per_million_brl,
       output_cost_per_million_brl,audio_cost_per_minute_brl,source_reference,
       created_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [scope.organization_id,projectId,model,operation,input||null,output||null,
       audio||null,source||null,scope.actor_user_id])).rows[0]!;
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,before,after)
       values($1,$2,$3,'ai_pricing_version_created','ai_pricing',$4,$5::jsonb,$6::jsonb)`,
      [scope.organization_id,projectId,scope.actor_user_id,created.id,
       JSON.stringify({replacedVersionIds:previous.rows.map((row)=>row.id)}),
       JSON.stringify({model,operation,input,output,audio,sourceReference:source||null})]);
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    console.error("ai_pricing_save_failed",{code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown"});
    redirect("/dashboard/integracoes?status=pricing-save-failed");
  }finally{client.release();}
  revalidatePath("/dashboard/integracoes");
  redirect("/dashboard/integracoes?status=pricing-saved");
}

export async function validateIntegrationConnection(formData: FormData) {
  const provider = field(formData, "provider", 50);
  const projectId = field(formData, "project_id", 64);
  const requestedConnectionId = field(formData, "connection_id", 64);
  if (!["cloudflare_r2", "clamav", "meta_ads", "railway","cloudflare_account"].includes(provider) || !projectId) {
    redirect("/dashboard/integracoes?status=test-unsupported");
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveIntegrationProject(data.user.id, projectId);
  const database = getDatabase();
  const scope = await database.pool.query<{
    organization_id: string;
    actor_user_id: string;
    connection_id: string;
  }>(
    `select project.organization_id, app_user.id as actor_user_id,
            connection.id as connection_id
       from public.projects project
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = project.organization_id
        and membership.user_id = app_user.id
       join public.connections connection
         on connection.project_id = project.id
        and connection.provider = $3
        and ($4::uuid is null or connection.id = $4)
      where project.id = $2 and app_user.status = 'active'
        and coalesce((select p.role_override from public.project_memberships p
          where p.membership_id=membership.id and p.project_id=project.id),
          membership.role) in ('owner', 'administrator')
        and (
          not exists (select 1 from public.project_memberships p
            where p.membership_id = membership.id)
          or exists (select 1 from public.project_memberships p
            where p.membership_id = membership.id and p.project_id = project.id
              and coalesce(p.role_override, membership.role)
                  in ('owner', 'administrator'))
        )
      order by connection.created_at desc limit 1`,
    [data.user.id, projectId, provider, requestedConnectionId || null],
  );
  const authorized = scope.rows[0];
  if (!authorized) redirect("/dashboard/integracoes?status=forbidden");
  try {
    if (provider === "cloudflare_r2") {
      const config = await loadProjectR2PreviewConfig(database.pool, projectId);
      if (!config) throw new Error("r2_not_configured");
      const client = createR2PreviewClient(config);
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } finally {
        client.destroy();
      }
    } else if (provider === "railway") {
      const stored = await database.pool.query<{
        ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer;
      }>(`select ciphertext,initialization_vector,authentication_tag
        from public.integration_secrets where project_id=$1 and provider='railway'
        and kind='credential_bundle' and rotated_at is null
        order by created_at desc limit 1`,[projectId]);
      const encrypted=stored.rows[0];
      const vaultKey=loadIntegrationVaultKey();
      if(!encrypted||!vaultKey)throw new Error("railway_configuration_missing");
      const {decryptIntegrationSecret}=await import("../../../lib/integration-vault");
      const secret=decryptIntegrationSecret({
        ciphertext:encrypted.ciphertext,
        initializationVector:encrypted.initialization_vector,
        authenticationTag:encrypted.authentication_tag,
      },vaultKey);
      await validateRailwayToken(String(secret.apiToken??""));
    } else if(provider==="cloudflare_account"){
      const stored=await database.pool.query<{
       ciphertext:Buffer;initialization_vector:Buffer;authentication_tag:Buffer;
      }>(`select ciphertext,initialization_vector,authentication_tag
        from public.integration_secrets where project_id=$1 and provider='cloudflare_account'
        and kind='credential_bundle' and rotated_at is null order by created_at desc limit 1`,[projectId]);
      const encrypted=stored.rows[0],vaultKey=loadIntegrationVaultKey();
      if(!encrypted||!vaultKey)throw new Error("cloudflare_configuration_missing");
      const {decryptIntegrationSecret}=await import("../../../lib/integration-vault");
      const secret=decryptIntegrationSecret({ciphertext:encrypted.ciphertext,
       initializationVector:encrypted.initialization_vector,
       authenticationTag:encrypted.authentication_tag},vaultKey);
      await validateCloudflareToken(String(secret.apiToken??""));
    } else if (provider === "meta_ads") {
      const stored = await database.pool.query<{
        configuration: Record<string, unknown>;
      }>(
        `select configuration from public.connections where id=$1`,
        [authorized.connection_id],
      );
      const row=stored.rows[0];
      const token=await loadMetaConnectionAccessToken(database.pool,authorized.connection_id);
      if (!row || !token) throw new Error("meta_configuration_missing");
      const allowlist=String(row.configuration.adAccountAllowlist??"")
        .split(",").filter(Boolean);
      const graphVersion="v25.0";
      const read=async(path:string)=>{
        const response=await fetch(`https://graph.facebook.com/${graphVersion}/${path}`,{
          headers:{Authorization:`Bearer ${token}`},
          signal:AbortSignal.timeout(20_000),
          cache:"no-store",
        });
        if(!response.ok) throw new Error(`meta_http_${response.status}`);
        return response.json() as Promise<Record<string,unknown>>;
      };
      const readAll=async(path:string)=>{
        const items:Record<string,unknown>[]=[];
        let after="";
        for(let page=0;page<20;page+=1){
          const separator=path.includes("?")?"&":"?";
          const payload=await read(
            `${path}${separator}limit=100${after?`&after=${encodeURIComponent(after)}`:""}`,
          );
          const data=Array.isArray(payload.data)?payload.data:[];
          items.push(...data.filter((item):item is Record<string,unknown> =>
            Boolean(item)&&typeof item==="object",
          ));
          const paging=payload.paging as Record<string,unknown>|undefined;
          const cursors=paging?.cursors as Record<string,unknown>|undefined;
          const nextAfter=String(cursors?.after??"");
          if(!paging?.next||!nextAfter||nextAfter===after) break;
          after=nextAfter;
        }
        return items;
      };
      const profile=await read("me?fields=id,name");
      const accounts=[];
      for(const accountId of allowlist){
        const account=await read(
          `${encodeURIComponent(accountId)}?fields=id,name,account_status,currency,timezone_name`,
        );
        accounts.push({
          id:String(account.id??accountId),
          name:String(account.name??""),
          accountStatus:Number(account.account_status??0),
          currency:String(account.currency??""),
          timezone:String(account.timezone_name??""),
        });
        const accountRow=await database.pool.query<{id:string;currency:string}>(
          `insert into public.meta_ad_accounts (
             organization_id,project_id,connection_id,external_id,name,
             account_status,currency,timezone_name,currency_status,currency_source,
             currency_confirmed_at,last_synced_at,updated_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,
             case when nullif($7,'') is null then 'unconfirmed' else 'confirmed_provider' end,
             case when nullif($7,'') is null then null else 'meta_api' end,
             case when nullif($7,'') is null then null else now() end,now(),now())
           on conflict (project_id,external_id) do update set
             connection_id=excluded.connection_id,name=excluded.name,
             account_status=excluded.account_status,
             currency=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency else excluded.currency end,
             currency_status=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_status else excluded.currency_status end,
             currency_source=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_source else excluded.currency_source end,
             currency_confirmed_at=case when meta_ad_accounts.currency_status='confirmed_manual' then meta_ad_accounts.currency_confirmed_at else excluded.currency_confirmed_at end,
             timezone_name=excluded.timezone_name,last_synced_at=now(),updated_at=now()
           returning id,currency`,
          [authorized.organization_id,projectId,authorized.connection_id,
           String(account.id??accountId),String(account.name??accountId),
           Number(account.account_status??0),String(account.currency??""),
           String(account.timezone_name??"")],
        );
        const localAccountId=accountRow.rows[0]?.id;
        if(!localAccountId) throw new Error("meta_account_upsert_failed");
      }
      await database.pool.query(
        `update public.connections set configuration=configuration ||
          jsonb_build_object('graphVersion',$2::text,'validatedAccounts',$3::jsonb)
          where id=$1`,
        [authorized.connection_id,graphVersion,JSON.stringify(accounts)],
      );
      await database.pool.query(
        `update public.meta_authorizations set
           external_subject_id=$2,external_subject_name=$3,
           granted_scopes=array['ads_read','business_management'],
           status='active',last_validated_at=now(),updated_at=now()
         where connection_id=$1`,
        [authorized.connection_id,String(profile.id??""),
         String(profile.name??"")],
      );
    } else {
      const connection = await database.pool.query<{
        configuration: Record<string, unknown>;
      }>(
        `select configuration from public.connections where id = $1`,
        [authorized.connection_id],
      );
      const configuration = connection.rows[0]?.configuration ?? {};
      const host = String(configuration.host ?? "").trim();
      const port = Number(configuration.port ?? 3310);
      if (!host || !Number.isSafeInteger(port)) {
        throw new Error("clamav_configuration_invalid");
      }
      await checkClamAvConnection({ host, port });
    }
    await database.pool.query(
      `update public.connections
          set configuration = configuration ||
                jsonb_build_object('validationStatus', 'valid',
                                   'lastValidatedAt', now()),
              updated_at = now()
        where id = $1`,
      [authorized.connection_id],
    );
    await database.pool.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, after
       ) values ($1, $2, $3, 'integration_connection_validated',
                 'connection', $4, $5::jsonb)`,
      [
        authorized.organization_id,
        projectId,
        authorized.actor_user_id,
        authorized.connection_id,
        JSON.stringify({ provider, status: "valid" }),
      ],
    );
  } catch (error) {
    console.error("integration_connection_validation_failed", {
      provider,
      code:
        error && typeof error === "object" && "name" in error
          ? String(error.name)
          : "unknown",
    });
    const failureClient = await database.pool.connect();
    try {
      await failureClient.query("begin");
      await failureClient.query(
        `update public.connections
            set configuration = (configuration - 'lastValidatedAt') ||
                  jsonb_build_object(
                    'validationStatus', 'invalid',
                    'lastValidationFailedAt', now()
                  ),
                updated_at = now()
          where id = $1`,
        [authorized.connection_id],
      );
      await failureClient.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1, $2, $3, 'integration_connection_validation_failed',
                   'connection', $4, $5::jsonb)`,
        [
          authorized.organization_id,
          projectId,
          authorized.actor_user_id,
          authorized.connection_id,
          JSON.stringify({ provider, status: "invalid" }),
        ],
      );
      await failureClient.query("commit");
    } catch (persistenceError) {
      await failureClient.query("rollback");
      console.error("integration_validation_failure_persistence_failed", {
        provider,
        code:
          persistenceError &&
          typeof persistenceError === "object" &&
          "name" in persistenceError
            ? String(persistenceError.name)
            : "unknown",
      });
    } finally {
      failureClient.release();
    }
    redirect(`/dashboard/integracoes?status=${provider}-test-failed`);
  }
  revalidatePath("/dashboard/integracoes");
  redirect(`/dashboard/integracoes?status=${provider}-valid`);
}

export async function revokeMetaConnection(formData:FormData){
  const projectId=field(formData,"project_id",64);
  const connectionId=field(formData,"connection_id",64);
  if(!projectId||!connectionId) redirect("/dashboard/integracoes?status=invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user) redirect("/login");
  await requireActiveIntegrationProject(data.user.id,projectId);
  const database=getDatabase();
  const scope=await database.pool.query<{organization_id:string;actor_user_id:string;mode:string}>(
    `select c.organization_id,u.id actor_user_id,
      coalesce(a.mode::text,'system_user') mode from public.connections c
      join public.users u on u.auth_user_id=$1 join public.memberships m
      on m.organization_id=c.organization_id and m.user_id=u.id
      left join public.meta_authorizations a on a.connection_id=c.id
      where c.id=$2 and c.project_id=$3 and c.provider='meta_ads'
      and coalesce((select allowed.role_override
        from public.project_memberships allowed
        where allowed.membership_id=m.id and allowed.project_id=c.project_id),
        m.role) in ('owner','administrator') limit 1`,
    [data.user.id,connectionId,projectId]);
  const row=scope.rows[0];if(!row) redirect("/dashboard/integracoes?status=forbidden");
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    await client.query(`update public.connections set status='revoked',updated_at=now() where id=$1`,[connectionId]);
    await client.query(`update public.meta_authorizations set status='revoked',revoked_at=now(),updated_at=now() where connection_id=$1`,[connectionId]);
    if(row.mode==="oauth_user"){
      await client.query(`update public.integration_secrets set rotated_at=now()
        where project_id=$1 and provider='meta_ads' and kind='oauth_access_token:'||$2::text and rotated_at is null`,
        [projectId,connectionId]);
    }
    await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
      action,target_type,target_id,after) values($1,$2,$3,'meta_authorization_revoked',
      'connection',$4,'{"status":"revoked"}'::jsonb)`,
      [row.organization_id,projectId,row.actor_user_id,connectionId]);
    await client.query("commit");
  }catch{await client.query("rollback");redirect("/dashboard/integracoes?status=meta-revoke-failed")}
  finally{client.release()}
  revalidatePath("/dashboard/integracoes");
  redirect("/dashboard/integracoes?status=meta-revoked");
}

export async function updateMetaSyncSchedule(formData:FormData){
  const projectId=field(formData,"project_id",64);
  const connectionId=field(formData,"connection_id",64);
  const enabled=field(formData,"enabled",10)==="true";
  const interval=Number(field(formData,"interval_minutes",10));
  const allowedIntervals=[60,180,360,720,1440];
  if(!projectId||!connectionId||!allowedIntervals.includes(interval)){
    redirect("/dashboard/integracoes?status=meta-schedule-invalid");
  }
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveIntegrationProject(data.user.id,projectId);
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{
      organization_id:string;actor_user_id:string;previous_enabled:boolean|null;
      previous_interval:number|null;
    }>(
      `select connection.organization_id,app_user.id actor_user_id,
              schedule.enabled previous_enabled,
              schedule.interval_minutes previous_interval
         from public.connections connection
         join public.users app_user on app_user.auth_user_id=$1
         join public.memberships membership
           on membership.organization_id=connection.organization_id
          and membership.user_id=app_user.id
         left join public.meta_sync_schedules schedule
           on schedule.connection_id=connection.id
        where connection.id=$2 and connection.project_id=$3
          and connection.provider='meta_ads' and connection.status='active'
          and coalesce((select allowed.role_override
            from public.project_memberships allowed
            where allowed.membership_id=membership.id
              and allowed.project_id=connection.project_id),membership.role)
              in ('owner','administrator')
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=connection.project_id
                            and coalesce(allowed.role_override,membership.role)
                                in ('owner','administrator')))
        limit 1`,
      [data.user.id,connectionId,projectId],
    )).rows[0];
    if(!scope){await client.query("rollback");
      redirect("/dashboard/integracoes?status=forbidden")}
    await client.query(
      `insert into public.meta_sync_schedules(
         organization_id,project_id,connection_id,enabled,interval_minutes,
         next_run_at
       ) values($1,$2,$3,$4,$5,case when $4 then now() else null end)
       on conflict(connection_id) do update set
         enabled=excluded.enabled,interval_minutes=excluded.interval_minutes,
         next_run_at=case
           when excluded.enabled and not meta_sync_schedules.enabled then now()
           when excluded.enabled then coalesce(meta_sync_schedules.next_run_at,now())
           else null end,
         updated_at=now()`,
      [scope.organization_id,projectId,connectionId,enabled,interval],
    );
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
         action,target_type,target_id,before,after)
       values($1,$2,$3,'meta_sync_schedule_updated','connection',$4,$5::jsonb,$6::jsonb)`,
      [scope.organization_id,projectId,scope.actor_user_id,connectionId,
       JSON.stringify({enabled:scope.previous_enabled,
         intervalMinutes:scope.previous_interval}),
       JSON.stringify({enabled,intervalMinutes:interval})],
    );
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    console.error("meta_sync_schedule_update_failed",{
      code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown",
    });
    redirect("/dashboard/integracoes?status=meta-schedule-failed");
  }finally{client.release()}
  revalidatePath("/dashboard/integracoes");
  redirect(`/dashboard/integracoes?status=${enabled
    ?"meta-schedule-enabled":"meta-schedule-disabled"}`);
}

export async function correctMetaAccountCurrency(formData:FormData){
  const projectId=field(formData,"project_id",64),accountId=field(formData,"account_id",64);
  const currency=field(formData,"currency",3).toUpperCase();
  if(!projectId||!accountId||!/^[A-Z]{3}$/.test(currency))redirect("/dashboard/integracoes?status=currency-correction-invalid");
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveIntegrationProject(data.user.id,projectId);
  const database=getDatabase(),client=await database.pool.connect();
  try{
    await client.query("begin");
    const account=(await client.query<{organization_id:string;actor_user_id:string;currency:string|null}>(
      `select account.organization_id,app_user.id actor_user_id,account.currency
       from public.meta_ad_accounts account join public.users app_user on app_user.auth_user_id=$1
       join public.memberships membership on membership.organization_id=account.organization_id and membership.user_id=app_user.id
       where account.id=$2 and account.project_id=$3 and coalesce((select allowed.role_override
         from public.project_memberships allowed where allowed.membership_id=membership.id
         and allowed.project_id=account.project_id),membership.role) in ('owner','administrator')
       for update of account limit 1`,[data.user.id,accountId,projectId])).rows[0];
    if(!account){await client.query("rollback");redirect("/dashboard/integracoes?status=forbidden")}
    await client.query(`update public.meta_ad_accounts set currency=$2,currency_status='confirmed_manual',
      currency_source='manual',currency_confirmed_at=now(),currency_confirmed_by_user_id=$3,
      currency_updated_at=now(),updated_at=now() where id=$1`,[accountId,currency,account.actor_user_id]);
    const impacted=await client.query(`update public.meta_ad_insights_daily set currency=$2,
      original_currency=case when spend_original is null then null else $2 end,
      spend_base=null,base_currency=null,exchange_rate=null,
      exchange_rate_date=null,exchange_rate_source=null,exchange_rate_source_version=null,
      conversion_rule_version=null,conversion_status='pending_rate',conversion_error_code=null,
      converted_at=null,updated_at=now() where meta_ad_account_id=$1`,[accountId,currency]);
    await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,action,
      target_type,target_id,before,after) values($1,$2,$3,'meta_ad_account_currency_corrected',
      'meta_ad_account',$4,$5::jsonb,$6::jsonb)`,[account.organization_id,projectId,account.actor_user_id,
      accountId,JSON.stringify({currency:account.currency}),JSON.stringify({currency,
        impactedRows:impacted.rowCount??0,reprocessing:"queued"})]);
    await client.query("commit");
  }catch(error){await client.query("rollback");console.error("meta_account_currency_correction_failed",{
    code:error&&typeof error==="object"&&"code" in error?String(error.code):"unknown"});
    redirect("/dashboard/integracoes?status=currency-correction-failed")
  }finally{client.release()}
  revalidatePath("/dashboard/integracoes");redirect("/dashboard/integracoes?status=currency-correction-saved");
}

export async function queueMetaSyncNow(formData:FormData){
  const projectId=field(formData,"project_id",64);
  const connectionId=field(formData,"connection_id",64);
  if(!projectId||!connectionId){
    redirect("/dashboard/integracoes?status=meta-sync-invalid");
  }
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveIntegrationProject(data.user.id,projectId);
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{organization_id:string;actor_user_id:string}>(
      `select connection.organization_id,app_user.id actor_user_id
         from public.connections connection
         join public.users app_user on app_user.auth_user_id=$1
         join public.memberships membership
           on membership.organization_id=connection.organization_id
          and membership.user_id=app_user.id
         join public.meta_authorizations authorization
           on authorization.connection_id=connection.id
        where connection.id=$2 and connection.project_id=$3
          and connection.provider='meta_ads' and connection.status='active'
          and authorization.status='active'
          and coalesce((select allowed.role_override
            from public.project_memberships allowed
            where allowed.membership_id=membership.id
              and allowed.project_id=connection.project_id),membership.role)
              in ('owner','administrator')
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=connection.project_id
                            and coalesce(allowed.role_override,membership.role)
                                in ('owner','administrator')))
        limit 1`,
      [data.user.id,connectionId,projectId],
    )).rows[0];
    if(!scope)throw new Error("meta_sync_forbidden");
    const inserted=(await client.query<{id:string}>(
      `insert into public.meta_sync_runs(
         organization_id,project_id,connection_id,idempotency_key,status,
         scheduled_for,next_attempt_at
       ) select $1,$2,$3,
           'manual:'||$3::text||':'||to_char(now() at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI'),
           'queued',now(),now()
        where not exists(
          select 1 from public.meta_sync_runs active
           where active.connection_id=$3
             and active.status in ('queued','running','failed_retryable')
        )
       on conflict(connection_id,idempotency_key) do nothing returning id`,
      [scope.organization_id,projectId,connectionId],
    )).rows[0];
    if(inserted){
      await client.query(
        `insert into public.audit_logs(organization_id,project_id,actor_user_id,
           action,target_type,target_id,after)
         values($1,$2,$3,'meta_sync_requested','meta_sync_run',$4,
                jsonb_build_object('connectionId',$5::text,'mode','manual'))`,
        [scope.organization_id,projectId,scope.actor_user_id,inserted.id,connectionId],
      );
    }
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    console.error("meta_sync_queue_failed",{
      code:error&&typeof error==="object"&&"message"in error
        ?String(error.message):"unknown",
    });
    redirect("/dashboard/integracoes?status=meta-sync-failed");
  }finally{client.release()}
  revalidatePath("/dashboard/integracoes");
  redirect("/dashboard/integracoes?status=meta-sync-queued");
}
