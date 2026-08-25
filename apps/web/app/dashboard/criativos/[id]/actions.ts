"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "../../../../lib/database";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";

function value(formData: FormData, name: string, max: number) {
  const raw = formData.get(name);
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, max);
}

function normalizedTag(tag: string) {
  return tag
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function requireActiveCreative(authUserId: string, creativeId: string) {
  const active = await getActiveProject(authUserId);
  if (!active.project) redirect("/dashboard/projetos");
  const database = getDatabase();
  const belongsToActiveProject = await database.pool.query(
    `select 1 from public.creatives where id=$1 and project_id=$2 limit 1`,
    [creativeId, active.project.id],
  );
  if (!belongsToActiveProject.rows[0]) {
    redirect("/dashboard/criativos?status=forbidden");
  }
}

export async function saveCreativeEditorial(formData: FormData) {
  const creativeId = value(formData, "creative_id", 64);
  const versionId = value(formData, "version_id", 64);
  const copyText = value(formData, "copy_text", 20_000);
  const headline = value(formData, "headline", 500);
  const cta = value(formData, "cta", 200);
  const destinationUrl = value(formData, "destination_url", 2_000);
  const notes = value(formData, "notes", 10_000);
  const tagInput = value(formData, "tags", 2_000);
  if (!creativeId || !versionId) redirect("/dashboard/criativos");
  if (destinationUrl) {
    try {
      const url = new URL(destinationUrl);
      if (url.protocol !== "https:") throw new Error("invalid_protocol");
    } catch {
      redirect(`/dashboard/criativos/${creativeId}?status=invalid-url`);
    }
  }
  const tags = [
    ...new Map(
      tagInput
        .split(",")
        .map((tag) => tag.trim().slice(0, 80))
        .filter(Boolean)
        .map((tag) => [normalizedTag(tag), tag] as const)
        .filter(([normalized]) => Boolean(normalized)),
    ).entries(),
  ].slice(0, 30);

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database = getDatabase();
  const scope = await database.pool.query<{
    organization_id: string;
    project_id: string;
    actor_user_id: string;
  }>(
    `select creative.organization_id, creative.project_id,
            app_user.id as actor_user_id
       from public.creatives creative
       join public.creative_versions version
         on version.id = $3 and version.creative_id = creative.id
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = creative.organization_id
        and membership.user_id = app_user.id
      where creative.id = $2 and app_user.status = 'active'
        and membership.role in ('owner', 'administrator', 'editor')
        and (
          not exists (
            select 1 from public.project_memberships restricted
             where restricted.membership_id = membership.id
          )
          or exists (
            select 1 from public.project_memberships allowed
             where allowed.membership_id = membership.id
               and allowed.project_id = creative.project_id
               and coalesce(allowed.role_override, membership.role)
                   in ('owner', 'administrator', 'editor')
          )
        )
      limit 1`,
    [data.user.id, creativeId, versionId],
  );
  const authorized = scope.rows[0];
  if (!authorized) {
    redirect(`/dashboard/criativos/${creativeId}?status=forbidden`);
  }

  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      versionId,
    ]);
    const beforeMetadata = await client.query(
      `select copy_text, headline, cta, destination_url, notes
         from public.creative_editorial_metadata
        where creative_id = $1 and creative_version_id = $2
        limit 1`,
      [creativeId, versionId],
    );
    const beforeTags = await client.query<{ normalized_name: string }>(
      `select tag.normalized_name
         from public.creative_tag_assignments assignment
         join public.creative_tags tag on tag.id = assignment.tag_id
        where assignment.creative_version_id = $1
          and assignment.source = 'manual'
          and assignment.removed_at is null`,
      [versionId],
    );
    await client.query(
      `insert into public.creative_editorial_metadata (
         organization_id, project_id, creative_id, creative_version_id,
         copy_text, headline, cta, destination_url, notes, updated_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (creative_id, creative_version_id)
       do update set copy_text = excluded.copy_text,
                     headline = excluded.headline,
                     cta = excluded.cta,
                     destination_url = excluded.destination_url,
                     notes = excluded.notes,
                     updated_by_user_id = excluded.updated_by_user_id,
                     updated_at = now()`,
      [
        authorized.organization_id,
        authorized.project_id,
        creativeId,
        versionId,
        copyText || null,
        headline || null,
        cta || null,
        destinationUrl || null,
        notes || null,
        authorized.actor_user_id,
      ],
    );
    const normalizedTags = tags.map(([normalized]) => normalized);
    await client.query(
      `update public.creative_tag_assignments assignment
          set removed_at = now()
         from public.creative_tags tag
        where assignment.tag_id = tag.id
          and assignment.creative_version_id = $1
          and assignment.source = 'manual'
          and assignment.removed_at is null
          and not (tag.normalized_name = any($2::text[]))`,
      [versionId, normalizedTags],
    );
    for (const [normalized, display] of tags) {
      const tag = await client.query<{ id: string }>(
        `insert into public.creative_tags (
           organization_id, project_id, name, normalized_name,
           created_by_user_id
         ) values ($1, $2, $3, $4, $5)
         on conflict (organization_id, project_id, normalized_name)
         do update set name = excluded.name
         returning id`,
        [
          authorized.organization_id,
          authorized.project_id,
          display,
          normalized,
          authorized.actor_user_id,
        ],
      );
      await client.query(
        `insert into public.creative_tag_assignments (
           organization_id, project_id, creative_id, creative_version_id,
           tag_id, source, assigned_by_user_id
         )
         select $1, $2, $3, $4, $5, 'manual', $6
          where not exists (
            select 1 from public.creative_tag_assignments existing
             where existing.creative_version_id = $4
               and existing.tag_id = $5
               and existing.source = 'manual'
               and existing.removed_at is null
          )`,
        [
          authorized.organization_id,
          authorized.project_id,
          creativeId,
          versionId,
          tag.rows[0]!.id,
          authorized.actor_user_id,
        ],
      );
    }
    const after = {
      copyText: copyText || null,
      headline: headline || null,
      cta: cta || null,
      destinationUrl: destinationUrl || null,
      notes: notes || null,
      tags: normalizedTags,
    };
    await client.query(
      `insert into public.audit_logs (
         organization_id, project_id, actor_user_id, action,
         target_type, target_id, before, after
       ) values ($1, $2, $3, 'creative_metadata_updated',
                 'creative_version', $4, $5::jsonb, $6::jsonb)`,
      [
        authorized.organization_id,
        authorized.project_id,
        authorized.actor_user_id,
        versionId,
        JSON.stringify({
          metadata: beforeMetadata.rows[0] ?? null,
          tags: beforeTags.rows.map((tag) => tag.normalized_name),
        }),
        JSON.stringify(after),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect(`/dashboard/criativos/${creativeId}?status=save-failed`);
  } finally {
    client.release();
  }
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=saved`);
}

export async function createPublicationPreview(formData:FormData){
  const creativeId=value(formData,"creative_id",64),versionId=value(formData,"version_id",64);
  const connectionId=value(formData,"connection_id",64),accountId=value(formData,"account_id",80);
  const campaignId=value(formData,"campaign_id",80),adSetId=value(formData,"ad_set_id",80);
  const destinationUrl=value(formData,"destination_url",2000);
  const dailyBudget=Number(value(formData,"daily_budget",30));
  if(!creativeId||!versionId||!connectionId||!accountId||!campaignId||!adSetId||
    !Number.isFinite(dailyBudget)||dailyBudget<=0) redirect(`/dashboard/criativos/${creativeId}?status=publication-invalid`);
  try{if(new URL(destinationUrl).protocol!=="https:")throw new Error()}catch{
    redirect(`/dashboard/criativos/${creativeId}?status=publication-invalid`);
  }
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database=getDatabase();
  const scope=await database.pool.query<{
    organization_id:string;project_id:string;actor_user_id:string;approval_id:string;
    currency:string;account_name:string;campaign_name:string;ad_set_name:string;
  }>(
    `select c.organization_id,c.project_id,u.id actor_user_id,a.id approval_id,
      ma.currency,ma.name account_name,mc.name campaign_name,ms.name ad_set_name
     from public.creatives c join public.creative_versions v on v.id=$3 and v.creative_id=c.id
     join public.creative_approvals a on a.creative_id=c.id and a.creative_version_id=v.id
       and a.decision='approved'
     join public.users u on u.auth_user_id=$1 join public.memberships m
       on m.organization_id=c.organization_id and m.user_id=u.id
     join public.meta_ad_accounts ma on ma.project_id=c.project_id and ma.connection_id=$4 and ma.external_id=$5
     join public.meta_campaigns mc on mc.meta_ad_account_id=ma.id and mc.external_id=$6
     join public.meta_ad_sets ms on ms.meta_campaign_id=mc.id and ms.external_id=$7
     where c.id=$2 and c.status='approved' and m.role in ('owner','administrator','editor')
     order by a.decided_at desc limit 1`,
    [data.user.id,creativeId,versionId,connectionId,accountId,campaignId,adSetId]);
  const row=scope.rows[0];if(!row)redirect(`/dashboard/criativos/${creativeId}?status=publication-forbidden`);
  const snapshot={creativeId,creativeVersionId:versionId,connectionId,accountId,
    accountName:row.account_name,campaignId,campaignName:row.campaign_name,
    adSetId,adSetName:row.ad_set_name,destinationUrl,dailyBudget,
    currency:row.currency||"BRL"};
  const serialized=JSON.stringify(snapshot);
  const sha=createHash("sha256").update(serialized).digest("hex");
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    const request=await client.query<{id:string}>(
      `insert into public.creative_publication_requests(organization_id,project_id,
       creative_id,creative_version_id,creative_approval_id,meta_connection_id,
       ad_account_external_id,campaign_external_id,ad_set_external_id,destination_url,
       daily_budget,currency,status,requested_by_user_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'preview_ready',$13) returning id`,
      [row.organization_id,row.project_id,creativeId,versionId,row.approval_id,connectionId,
       accountId,campaignId,adSetId,destinationUrl,dailyBudget,row.currency||"BRL",row.actor_user_id]);
    await client.query(
      `insert into public.creative_publication_previews(publication_request_id,snapshot,
       snapshot_sha256,generated_by_user_id) values($1,$2::jsonb,$3,$4)`,
      [request.rows[0]!.id,serialized,sha,row.actor_user_id]);
    await client.query(`insert into public.audit_logs(organization_id,project_id,actor_user_id,
      action,target_type,target_id,after) values($1,$2,$3,'creative_publication_preview_created',
      'creative_publication_request',$4,$5::jsonb)`,
      [row.organization_id,row.project_id,row.actor_user_id,request.rows[0]!.id,
       JSON.stringify({snapshotSha256:sha})]);
    await client.query("commit");
  }catch{await client.query("rollback");redirect(`/dashboard/criativos/${creativeId}?status=publication-failed`)}
  finally{client.release()}
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=publication-preview-created`);
}

export async function approvePublicationPreview(formData:FormData){
  const creativeId=value(formData,"creative_id",64);
  const requestId=value(formData,"publication_request_id",64);
  const previewId=value(formData,"publication_preview_id",64);
  const expectedHash=value(formData,"snapshot_sha256",64);
  if(!creativeId||!requestId||!previewId||!/^[a-f0-9]{64}$/.test(expectedHash))
    redirect(`/dashboard/criativos/${creativeId}?status=publication-approval-invalid`);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database=getDatabase();
  const scope=await database.pool.query<{
    organization_id:string;project_id:string;actor_user_id:string;snapshot_sha256:string;
  }>(
    `select r.organization_id,r.project_id,u.id actor_user_id,p.snapshot_sha256
     from public.creative_publication_requests r
     join public.creative_publication_previews p on p.id=$4 and p.publication_request_id=r.id
     join public.users u on u.auth_user_id=$1 join public.memberships m
       on m.organization_id=r.organization_id and m.user_id=u.id
     where r.id=$3 and r.creative_id=$2 and r.status='preview_ready'
       and m.role in ('owner','administrator') limit 1`,
    [data.user.id,creativeId,requestId,previewId]);
  const row=scope.rows[0];
  if(!row||row.snapshot_sha256!==expectedHash)
    redirect(`/dashboard/criativos/${creativeId}?status=publication-approval-forbidden`);
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    await client.query(
      `insert into public.creative_publication_approvals(publication_request_id,
       publication_preview_id,snapshot_sha256,approved_by_user_id)
       values($1,$2,$3,$4)`,
      [requestId,previewId,expectedHash,row.actor_user_id]);
    await client.query(`update public.creative_publication_requests
      set status='action_approved',updated_at=now() where id=$1`,[requestId]);
    await client.query(`insert into public.audit_logs(organization_id,project_id,
      actor_user_id,action,target_type,target_id,after)
      values($1,$2,$3,'creative_publication_approved',
      'creative_publication_request',$4,$5::jsonb)`,
      [row.organization_id,row.project_id,row.actor_user_id,requestId,
       JSON.stringify({publicationPreviewId:previewId,snapshotSha256:expectedHash})]);
    await client.query("commit");
  }catch{await client.query("rollback");redirect(`/dashboard/criativos/${creativeId}?status=publication-approval-failed`)}
  finally{client.release()}
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=publication-approved`);
}

export async function simulatePublication(formData:FormData){
  const creativeId=value(formData,"creative_id",64),requestId=value(formData,"publication_request_id",64);
  if(!creativeId||!requestId)redirect(`/dashboard/criativos/${creativeId}?status=simulation-invalid`);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database=getDatabase();
  const scope=await database.pool.query<{
    organization_id:string;project_id:string;actor_user_id:string;approval_id:string;
    snapshot_sha256:string;preview_sha256:string;asset_ready:boolean;
    connection_active:boolean;targets_ready:boolean;
  }>(
    `select r.organization_id,r.project_id,u.id actor_user_id,pa.id approval_id,
      pa.snapshot_sha256,preview.snapshot_sha256 preview_sha256,
      (asset.available_at is not null and asset.malware_status='clean') asset_ready,
      (connection.status='active') connection_active,
      exists(
        select 1 from public.meta_ad_sets ad_set
        join public.meta_campaigns campaign on campaign.id=ad_set.meta_campaign_id
        join public.meta_ad_accounts account on account.id=campaign.meta_ad_account_id
        where ad_set.project_id=r.project_id
          and ad_set.external_id=r.ad_set_external_id
          and campaign.external_id=r.campaign_external_id
          and account.external_id=r.ad_account_external_id
          and account.connection_id=r.meta_connection_id
      ) targets_ready
     from public.creative_publication_requests r
     join public.creative_publication_approvals pa on pa.publication_request_id=r.id and pa.revoked_at is null
     join public.creative_publication_previews preview
       on preview.id=pa.publication_preview_id
      and preview.publication_request_id=r.id
     join public.creative_versions version on version.id=r.creative_version_id
     join public.creative_assets asset on asset.id=version.asset_id
     join public.connections connection on connection.id=r.meta_connection_id
     join public.users u on u.auth_user_id=$1 join public.memberships m
       on m.organization_id=r.organization_id and m.user_id=u.id
     where r.id=$2 and r.creative_id=$3 and r.status='action_approved'
       and m.role in ('owner','administrator') limit 1`,
    [data.user.id,requestId,creativeId]);
  const row=scope.rows[0];
  if(!row)
    redirect(`/dashboard/criativos/${creativeId}?status=simulation-not-ready`);
  const reconciled=row.asset_ready&&row.connection_active&&row.targets_ready
    &&row.snapshot_sha256===row.preview_sha256;
  const reconciliationFailures=[
    !row.asset_ready?"asset_not_ready":null,
    !row.connection_active?"connection_not_active":null,
    !row.targets_ready?"meta_targets_not_reconciled":null,
    row.snapshot_sha256!==row.preview_sha256?"approved_snapshot_mismatch":null,
  ].filter((item):item is string=>Boolean(item));
  const key=createHash("sha256").update(`meta-simulation:${requestId}:${row.approval_id}:${row.snapshot_sha256}`).digest("hex");
  await database.pool.query(
    `insert into public.meta_publication_executions(organization_id,project_id,
     publication_request_id,publication_approval_id,idempotency_key,mode,status,
     request_fingerprint,requested_by_user_id,started_at,finished_at,
     last_error_code,last_error_sanitized)
     values($1,$2,$3,$4,$5,'simulation',
       $8::public.meta_publication_execution_status,$6,$7,now(),now(),$9,$10)
     on conflict (publication_request_id,publication_approval_id) do nothing`,
    [row.organization_id,row.project_id,requestId,row.approval_id,key,
      row.snapshot_sha256,row.actor_user_id,
      reconciled?"simulation_completed":"reconciliation_required",
      reconciled?null:"reconciliation_failed",
      reconciled?null:reconciliationFailures.join(",")]);
  await database.pool.query(`insert into public.audit_logs(organization_id,project_id,
    actor_user_id,action,target_type,target_id,after)
    values($1,$2,$3,$4,
    'creative_publication_request',$5,$6::jsonb)`,
    [row.organization_id,row.project_id,row.actor_user_id,
     reconciled?"creative_publication_simulation_completed":
       "creative_publication_reconciliation_required",
     requestId,JSON.stringify({requestFingerprint:row.snapshot_sha256,
       externalWrite:false,reconciled,reconciliationFailures})]);
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=${
    reconciled?"simulation-completed":"reconciliation-required"}`);
}

export async function requestCreativeTranscription(formData: FormData) {
  const creativeId = value(formData, "creative_id", 64);
  const versionId = value(formData, "version_id", 64);
  if (!creativeId || !versionId) redirect("/dashboard/criativos");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database = getDatabase();
  const result = await database.pool.query<{
    organization_id: string; project_id: string; actor_user_id: string;
    content_sha256: string; mime_type: string; malware_status: string;
    available_at: Date | null; model: string;
  }>(
    `select creative.organization_id, creative.project_id,
            app_user.id actor_user_id, version.content_sha256,
            asset.mime_type, asset.malware_status::text, asset.available_at,
            connection.configuration->>'transcriptionModel' model
       from public.creatives creative
       join public.creative_versions version
         on version.id = $3 and version.creative_id = creative.id
       join public.creative_assets asset on asset.id = version.asset_id
       join public.users app_user on app_user.auth_user_id = $1
       join public.memberships membership
         on membership.organization_id = creative.organization_id
        and membership.user_id = app_user.id
       join lateral (
         select configuration from public.connections
          where project_id = creative.project_id and provider = 'openai'
            and status = 'active' order by created_at desc limit 1
       ) connection on true
      where creative.id = $2 and app_user.status = 'active'
        and coalesce(
          (select role_override::text from public.project_memberships
            where membership_id = membership.id
              and project_id = creative.project_id),
          membership.role::text
        ) in ('owner', 'administrator', 'editor')
        and (not exists (
               select 1 from public.project_memberships
                where membership_id = membership.id
             ) or exists (
               select 1 from public.project_memberships
                where membership_id = membership.id
                  and project_id = creative.project_id
             ))
      limit 1`,
    [data.user.id, creativeId, versionId],
  );
  const scope = result.rows[0];
  if (!scope) redirect(`/dashboard/criativos/${creativeId}?status=ai-unavailable`);
  if (!scope.mime_type.startsWith("video/") || scope.malware_status !== "clean" ||
      !scope.available_at || !scope.model) {
    redirect(`/dashboard/criativos/${creativeId}?status=ai-ineligible`);
  }
  const key = `transcription:v1:${scope.content_sha256}:${scope.model}`;
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into public.creative_ai_jobs (
         organization_id, project_id, creative_id, creative_version_id,
         kind, status, idempotency_key, model, requested_by_user_id
       ) values ($1,$2,$3,$4,'transcription','pending',$5,$6,$7)
       on conflict (creative_version_id, kind, idempotency_key) do nothing
       returning id`,
      [scope.organization_id, scope.project_id, creativeId, versionId,
       key, scope.model, scope.actor_user_id],
    );
    if (inserted.rows[0]) {
      await client.query(
        `insert into public.audit_logs (
           organization_id, project_id, actor_user_id, action,
           target_type, target_id, after
         ) values ($1,$2,$3,'creative_transcription_requested',
                   'creative_version',$4,
                   jsonb_build_object(
                     'jobId', $5::text,
                     'model', $6::text
                   ))`,
        [scope.organization_id, scope.project_id, scope.actor_user_id,
         versionId, inserted.rows[0].id, scope.model],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    console.error("creative_transcription_request_failed", {
      code:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
      constraint:
        error && typeof error === "object" && "constraint" in error
          ? String(error.constraint)
          : undefined,
    });
    redirect(`/dashboard/criativos/${creativeId}?status=ai-request-failed`);
  } finally {
    client.release();
  }
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=transcription-queued`);
}

export async function requestCreativeTextExtraction(formData:FormData){
  const creativeId=value(formData,"creative_id",64);
  const versionId=value(formData,"version_id",64);
  if(!creativeId||!versionId)redirect("/dashboard/criativos");
  const supabase=await createClient();
  const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database=getDatabase();
  const scope=(await database.pool.query<{
    organization_id:string;project_id:string;actor_user_id:string;
    content_sha256:string;mime_type:string;malware_status:string;available_at:Date|null;
  }>(
    `select creative.organization_id,creative.project_id,app_user.id actor_user_id,
     version.content_sha256,asset.mime_type,asset.malware_status::text,asset.available_at
     from public.creatives creative
     join public.creative_versions version on version.id=$3 and version.creative_id=creative.id
     join public.creative_assets asset on asset.id=version.asset_id
     join public.users app_user on app_user.auth_user_id=$1
     join public.memberships membership on membership.organization_id=creative.organization_id
      and membership.user_id=app_user.id
     where creative.id=$2 and app_user.status='active'
      and coalesce((select role_override::text from public.project_memberships
       where membership_id=membership.id and project_id=creative.project_id),
       membership.role::text) in ('owner','administrator','editor')
      and (not exists(select 1 from public.project_memberships where membership_id=membership.id)
       or exists(select 1 from public.project_memberships where membership_id=membership.id
        and project_id=creative.project_id)) limit 1`,
    [data.user.id,creativeId,versionId])).rows[0];
  const supported=new Set(["text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  if(!scope||!supported.has(scope.mime_type)||scope.malware_status!=="clean"||!scope.available_at)
    redirect(`/dashboard/criativos/${creativeId}?status=extraction-ineligible`);
  const key=`text-extraction:v1:${scope.content_sha256}`;
  const client=await database.pool.connect();
  try{
    await client.query("begin");
    const inserted=await client.query<{id:string}>(
      `insert into public.creative_ai_jobs(organization_id,project_id,creative_id,
       creative_version_id,kind,status,idempotency_key,model,requested_by_user_id)
       values($1,$2,$3,$4,'text_extraction','pending',$5,'local-extractor-v1',$6)
       on conflict(creative_version_id,kind,idempotency_key) do nothing returning id`,
      [scope.organization_id,scope.project_id,creativeId,versionId,key,scope.actor_user_id]);
    if(inserted.rows[0])await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,after) values($1,$2,$3,
       'creative_text_extraction_requested','creative_version',$4,
       jsonb_build_object('jobId',$5::text,'method','local'))`,
      [scope.organization_id,scope.project_id,scope.actor_user_id,versionId,inserted.rows[0].id]);
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    console.error("creative_text_extraction_request_failed",
      {code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown"});
    redirect(`/dashboard/criativos/${creativeId}?status=extraction-request-failed`);
  }finally{client.release();}
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=extraction-queued`);
}

export async function requestCreativeAnalysis(formData: FormData) {
  const creativeId = value(formData, "creative_id", 64);
  const versionId = value(formData, "version_id", 64);
  if (!creativeId || !versionId) redirect("/dashboard/criativos");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database = getDatabase();
  const scope = (await database.pool.query<{
    organization_id: string; project_id: string; actor_user_id: string;
    content_sha256: string; model: string; performance_fingerprint:string;
  }>(
    `select creative.organization_id, creative.project_id,
            app_user.id actor_user_id, version.content_sha256,
            connection.configuration->>'analysisModel' model,
            coalesce((select md5(concat(max(insight.metric_date)::text,':',
              sum(insight.spend_base) filter(where insight.conversion_status in ('converted','not_required'))::text,':',sum(insight.impressions)::text,':',
              sum(insight.clicks)::text))
              from public.creative_ad_links link
              join public.meta_ad_insights_daily insight on insight.meta_ad_id=link.meta_ad_id
              where link.creative_version_id=version.id),'none') performance_fingerprint
       from public.creatives creative
       join public.creative_versions version
         on version.id=$3 and version.creative_id=creative.id
       join public.users app_user on app_user.auth_user_id=$1
       join public.memberships membership
         on membership.organization_id=creative.organization_id
        and membership.user_id=app_user.id
       join lateral (
         select configuration from public.connections
          where project_id=creative.project_id and provider='openai'
            and status='active' order by created_at desc limit 1
       ) connection on true
      where creative.id=$2 and app_user.status='active'
        and coalesce((select role_override::text
          from public.project_memberships where membership_id=membership.id
          and project_id=creative.project_id),membership.role::text)
          in ('owner','administrator','editor')
        and exists (select 1 from public.creative_transcripts
                     where creative_version_id=version.id)
      limit 1`,
    [data.user.id, creativeId, versionId],
  )).rows[0];
  if (!scope?.model) redirect(`/dashboard/criativos/${creativeId}?status=ai-unavailable`);
  const promptVersion = "creative-analysis-v2-performance-aware";
  const key = `analysis:${promptVersion}:${scope.content_sha256}:${scope.model}:${scope.performance_fingerprint}`;
  const inserted = await database.pool.query<{ id: string }>(
    `insert into public.creative_ai_jobs (
       organization_id,project_id,creative_id,creative_version_id,kind,status,
       idempotency_key,model,prompt_version,requested_by_user_id
     ) values ($1,$2,$3,$4,'analysis','pending',$5,$6,$7,$8)
     on conflict (creative_version_id,kind,idempotency_key) do nothing
     returning id`,
    [scope.organization_id,scope.project_id,creativeId,versionId,key,
     scope.model,promptVersion,scope.actor_user_id],
  );
  if (inserted.rows[0]) {
    await database.pool.query(
      `insert into public.audit_logs (
         organization_id,project_id,actor_user_id,action,target_type,target_id,after
       ) values ($1,$2,$3,'creative_analysis_requested','creative_version',$4,
                 jsonb_build_object(
                   'jobId', $5::text,
                   'model', $6::text,
                   'promptVersion', $7::text
                 ))`,
      [scope.organization_id,scope.project_id,scope.actor_user_id,versionId,
       inserted.rows[0].id,scope.model,promptVersion],
    );
  }
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=analysis-queued`);
}

const performanceStatuses=new Set(["published","paused","winner","fatigued","archived"]);
export async function updateCreativePerformanceStatus(formData:FormData){
  const creativeId=value(formData,"creative_id",64);
  const versionId=value(formData,"version_id",64);
  const status=value(formData,"status",40);
  const reason=value(formData,"reason",1000);
  if(!creativeId||!versionId||!performanceStatuses.has(status)||reason.length<3)
    redirect(`/dashboard/criativos/${creativeId}?status=invalid-performance-status`);
  const supabase=await createClient();const {data}=await supabase.auth.getUser();
  if(!data.user)redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database=getDatabase();const client=await database.pool.connect();
  try{
    await client.query("begin");
    const scope=(await client.query<{
      organization_id:string;project_id:string;actor_user_id:string;old_status:string;
    }>(
      `select creative.organization_id,creative.project_id,
              app_user.id actor_user_id,creative.status::text old_status
         from public.creatives creative
         join public.creative_versions version
           on version.id=$3 and version.creative_id=creative.id
         join public.users app_user on app_user.auth_user_id=$1
         join public.memberships membership
           on membership.organization_id=creative.organization_id
          and membership.user_id=app_user.id
        where creative.id=$2 and creative.current_version_id=version.id
          and exists(select 1 from public.creative_ad_links link
                      where link.creative_version_id=version.id)
          and creative.status in('approved','ready_to_publish','published',
                                 'paused','winner','fatigued')
          and coalesce((select role_override::text from public.project_memberships
                         where membership_id=membership.id
                           and project_id=creative.project_id),membership.role::text)
              in('owner','administrator','editor')
          and (not exists(select 1 from public.project_memberships restricted
                           where restricted.membership_id=membership.id)
               or exists(select 1 from public.project_memberships allowed
                          where allowed.membership_id=membership.id
                            and allowed.project_id=creative.project_id))
        limit 1 for update`,[data.user.id,creativeId,versionId])).rows[0];
    if(!scope){await client.query("rollback");
      redirect(`/dashboard/criativos/${creativeId}?status=performance-transition-forbidden`);}
    await client.query(
      `update public.creatives set status=$1::public.creative_status,updated_at=now()
        where id=$2 and project_id=$3`,
      [status,creativeId,scope.project_id],
    );
    await client.query(
      `insert into public.audit_logs(organization_id,project_id,actor_user_id,
       action,target_type,target_id,reason,before,after)
       values($1,$2,$3,'creative_performance_status_changed','creative',$4,$5,
              jsonb_build_object('status',$6::text),
              jsonb_build_object('status',$7::text,'creativeVersionId',$8::text))`,
      [scope.organization_id,scope.project_id,scope.actor_user_id,creativeId,reason,
       scope.old_status,status,versionId],
    );
    await client.query("commit");
  }catch(error){
    await client.query("rollback");
    if(error&&typeof error==="object"&&"digest"in error)throw error;
    console.error("creative_performance_status_failed");
    redirect(`/dashboard/criativos/${creativeId}?status=performance-status-failed`);
  }finally{client.release();}
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=performance-status-updated`);
}

async function transitionCreativeReview(
  formData: FormData,
  action: "submit" | "approve" | "reject",
) {
  const creativeId = value(formData, "creative_id", 64);
  const versionId = value(formData, "version_id", 64);
  const reason = value(formData, "reason", 2_000);
  if (!creativeId || !versionId) redirect("/dashboard/criativos");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  await requireActiveCreative(data.user.id, creativeId);
  const database = getDatabase();
  const scope = (await database.pool.query<{
    organization_id:string;project_id:string;actor_user_id:string;
    status:string;effective_role:string;
  }>(`select creative.organization_id,creative.project_id,
      app_user.id actor_user_id,creative.status::text,
      coalesce((select role_override::text from project_memberships
       where membership_id=membership.id and project_id=creative.project_id),
       membership.role::text) effective_role
    from creatives creative
    join users app_user on app_user.auth_user_id=$1
    join memberships membership on membership.organization_id=creative.organization_id
      and membership.user_id=app_user.id
    where creative.id=$2 and creative.current_version_id=$3
      and (not exists(select 1 from project_memberships where membership_id=membership.id)
       or exists(select 1 from project_memberships where membership_id=membership.id
         and project_id=creative.project_id)) limit 1`,
    [data.user.id,creativeId,versionId])).rows[0];
  const allowed = action==="approve" || action==="reject"
    ? ["owner","administrator"].includes(scope?.effective_role ?? "")
    : ["owner","administrator","editor"].includes(scope?.effective_role ?? "");
  if (!scope || !allowed) redirect(`/dashboard/criativos/${creativeId}?status=forbidden`);
  if (action==="submit" && !["imported","analyzing"].includes(scope.status)) {
    redirect(`/dashboard/criativos/${creativeId}?status=review-invalid`);
  }
  if ((action==="approve" || action==="reject") && scope.status!=="awaiting_approval") {
    redirect(`/dashboard/criativos/${creativeId}?status=review-invalid`);
  }
  if (action==="submit") {
    const ready = await database.pool.query(
      `select 1 from creative_analyses where creative_version_id=$1 limit 1`,
      [versionId],
    );
    if (!ready.rowCount) redirect(`/dashboard/criativos/${creativeId}?status=analysis-required`);
  }
  if (action==="reject" && !reason) {
    redirect(`/dashboard/criativos/${creativeId}?status=review-reason-required`);
  }
  const toStatus = action==="submit"
    ? "awaiting_approval" : action==="approve" ? "approved" : "imported";
  const event = action==="submit"
    ? "creative_review_requested"
    : action==="approve" ? "creative_approved" : "creative_rejected";
  const client=await database.pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))",[creativeId]);
    await client.query(`update creatives set status=$2::creative_status,
      updated_at=now() where id=$1 and current_version_id=$3`,
      [creativeId,toStatus,versionId]);
    await client.query(`insert into creative_status_history
      (organization_id,project_id,creative_id,creative_version_id,from_status,
       to_status,changed_by_user_id,reason)
      values($1,$2,$3,$4,$5::creative_status,$6::creative_status,$7,$8)`,
      [scope.organization_id,scope.project_id,creativeId,versionId,scope.status,
       toStatus,scope.actor_user_id,reason||null]);
    if (action==="approve" || action==="reject") {
      await client.query(`insert into creative_approvals
        (organization_id,project_id,creative_id,creative_version_id,decision,
         decided_by_user_id,reason)
        values($1,$2,$3,$4,$5::creative_approval_decision,$6,$7)`,
        [scope.organization_id,scope.project_id,creativeId,versionId,
         action==="approve"?"approved":"rejected",scope.actor_user_id,reason||null]);
    }
    await client.query(`insert into audit_logs
      (organization_id,project_id,actor_user_id,action,target_type,target_id,after)
      values($1,$2,$3,$4,'creative_version',$5,
       jsonb_build_object('status',$6::text,'reason',$7::text))`,
      [scope.organization_id,scope.project_id,scope.actor_user_id,event,
       versionId,toStatus,reason||""]);
    await client.query("commit");
  } catch(error) {
    await client.query("rollback");
    console.error("creative_review_transition_failed",{
      code:error&&typeof error==="object"&&"code"in error?String(error.code):"unknown",
    });
    redirect(`/dashboard/criativos/${creativeId}?status=review-failed`);
  } finally { client.release(); }
  revalidatePath(`/dashboard/criativos/${creativeId}`);
  redirect(`/dashboard/criativos/${creativeId}?status=${
    action==="submit"?"review-requested":action==="approve"?"approved":"rejected"
  }`);
}

export async function submitCreativeForReview(formData:FormData) {
  return transitionCreativeReview(formData,"submit");
}

export async function approveCreativeVersion(formData:FormData) {
  return transitionCreativeReview(formData,"approve");
}

export async function rejectCreativeVersion(formData:FormData) {
  return transitionCreativeReview(formData,"reject");
}
