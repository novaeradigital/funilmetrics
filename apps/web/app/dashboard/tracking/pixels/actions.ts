"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "../../../../lib/supabase/server";
import { getActiveProject } from "../../../../lib/active-project";
import { getDatabase } from "../../../../lib/database";
import {
  encryptIntegrationSecret,
  loadIntegrationVaultKey,
} from "../../../../lib/integration-vault";
import {
  metaPixelSettings,
  type MetaPixelSettings,
} from "../../../../lib/meta-pixels";

const base = "/dashboard/tracking/pixels";
const allowedRoles = new Set(["owner", "administrator"]);
const uuidPattern = /^[0-9a-f-]{36}$/i;

function checkbox(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function settingsFromForm(formData: FormData): MetaPixelSettings {
  const blockIps = String(formData.get("block_ips") ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return metaPixelSettings({
    events: {
      pageView: checkbox(formData, "ev_page_view"),
      viewContent: checkbox(formData, "ev_view_content"),
      initiateCheckout: checkbox(formData, "ev_initiate_checkout"),
      purchase: checkbox(formData, "ev_purchase"),
      refund: checkbox(formData, "ev_refund"),
    },
    matching: {
      email: checkbox(formData, "match_email"),
      phone: checkbox(formData, "match_phone"),
      firstName: checkbox(formData, "match_first_name"),
      lastName: checkbox(formData, "match_last_name"),
      city: checkbox(formData, "match_city"),
      state: checkbox(formData, "match_state"),
      zip: checkbox(formData, "match_zip"),
      externalId: checkbox(formData, "match_external_id"),
      ip: checkbox(formData, "match_ip"),
      userAgent: checkbox(formData, "match_user_agent"),
    },
    valueRule: String(formData.get("value_rule") ?? "paid"),
    valueFixed: Number(formData.get("value_fixed") ?? "") || null,
    valuePercent: Number(formData.get("value_percent") ?? "") || null,
    contentIdsType: String(formData.get("content_ids_type") ?? "product"),
    contentIdsCustom: String(formData.get("content_ids_custom") ?? "") || null,
    blockIps,
  });
}

export async function saveBusinessMetaPixel(formData: FormData) {
  const businessId = String(formData.get("business_project_id") ?? "");
  const pixelId = String(formData.get("pixel_id") ?? "").trim();
  const mode = String(formData.get("mode") ?? "api");
  const active = checkbox(formData, "active");
  const testEventCode =
    String(formData.get("test_event_code") ?? "").trim() || null;
  const prefix =
    String(formData.get("event_id_prefix") ?? "fm-").trim() || "fm-";
  const token = String(formData.get("capi_token") ?? "").trim();
  if (
    !uuidPattern.test(businessId) ||
    !/^\d{5,32}$/.test(pixelId) ||
    !["api", "browser", "both", "off"].includes(mode)
  ) {
    redirect(`${base}?status=invalid`);
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { project } = await getActiveProject(data.user.id);
  if (!project || !allowedRoles.has(project.role)) {
    redirect(`${base}?status=forbidden`);
  }
  const db = getDatabase();
  const actor = (
    await db.pool.query<{ id: string }>(
      "select id from public.users where auth_user_id=$1",
      [data.user.id],
    )
  ).rows[0]!;
  const business = (
    await db.pool.query<{ id: string }>(
      "select id from public.business_projects where id=$1 and project_id=$2",
      [businessId, project.id],
    )
  ).rows[0];
  if (!business) redirect(`${base}?status=not-found`);

  const settings = settingsFromForm(formData);
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into public.business_meta_pixels(
         organization_id, project_id, business_project_id, pixel_id, active,
         mode, test_event_code, event_id_prefix, config)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       on conflict (business_project_id) do update set
         pixel_id = excluded.pixel_id, active = excluded.active,
         mode = excluded.mode, test_event_code = excluded.test_event_code,
         event_id_prefix = excluded.event_id_prefix,
         config = excluded.config, updated_at = now()`,
      [
        project.organization_id,
        project.id,
        businessId,
        pixelId,
        active,
        mode,
        testEventCode,
        prefix,
        JSON.stringify(settings),
      ],
    );
    if (token) {
      const key = loadIntegrationVaultKey();
      if (!key) throw new Error("integration_vault_disabled");
      const encrypted = encryptIntegrationSecret(
        { accessToken: token },
        key,
      );
      const kind = `capi_token:${businessId}`;
      await client.query(
        `update public.integration_secrets set rotated_at = now()
          where project_id = $1 and provider = 'meta_capi'
            and kind = $2 and rotated_at is null`,
        [project.id, kind],
      );
      await client.query(
        `insert into public.integration_secrets(
           organization_id, project_id, provider, kind, ciphertext,
           initialization_vector, authentication_tag)
         values($1,$2,'meta_capi',$3,$4,$5,$6)`,
        [
          project.organization_id,
          project.id,
          kind,
          encrypted.ciphertext,
          encrypted.initializationVector,
          encrypted.authenticationTag,
        ],
      );
    }
    await client.query(
      `insert into public.audit_logs(organization_id, project_id, actor_user_id,
         action, target_type, target_id, after)
       values($1,$2,$3,'business_meta_pixel_updated','business_project',$4,$5::jsonb)`,
      [
        project.organization_id,
        project.id,
        actor.id,
        businessId,
        JSON.stringify({
          pixelId,
          active,
          mode,
          testEventCode,
          prefix,
          tokenUpdated: Boolean(token),
          settings,
        }),
      ],
    );
    await client.query("commit");
  } catch {
    await client.query("rollback");
    redirect(`${base}?status=failed`);
  } finally {
    client.release();
  }
  revalidatePath(base);
  redirect(`${base}?status=saved`);
}
