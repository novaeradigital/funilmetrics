import type pg from "pg";
import {
  loadMetaConnectionAccessToken,
  loadProjectR2Config,
} from "./integration-credentials.js";
import { R2CreativeStorage } from "./r2-storage.js";

const graphVersion = "v25.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;
const graphVideoBase = `https://graph-video.facebook.com/${graphVersion}`;

type UploadRow = {
  id: string; organization_id: string; project_id: string;
  send_mode: string; config: Record<string, any>;
};
type ItemRow = {
  id: string; upload_id: string; account_external_id: string;
  level: "campaign" | "adset" | "ad"; name: string;
  creative_id: string | null; parent_item_id: string | null;
  external_id: string | null; status: string;
  copy: { primaryText: string; headline: string; cta: string } | null;
  payload: Record<string, any> | null;
};

async function claim(pool: pg.Pool): Promise<UploadRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<UploadRow>(
      `select id, organization_id, project_id, send_mode, config
         from public.campaign_uploads
        where status = 'queued'
        order by created_at
        for update skip locked
        limit 1`,
    );
    const upload = result.rows[0];
    if (!upload) { await client.query("commit"); return null; }
    await client.query(
      `update public.campaign_uploads
          set status = 'publishing', started_at = coalesce(started_at, now()),
              updated_at = now()
        where id = $1`, [upload.id]);
    await client.query("commit");
    return upload;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

type GraphError = { code: string; message: string };
async function graphPost(
  token: string, path: string, fields: Record<string, unknown>,
): Promise<Record<string, any>> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const response = await fetch(`${graphBase}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || payload.error) {
    throw graphFailure(payload, response.status);
  }
  return payload;
}

function graphFailure(payload: Record<string, any>, httpStatus: number): GraphError {
  const err = payload.error ?? {};
  const parts = [
    String(err.message ?? `http_${httpStatus}`),
    err.error_user_title ? String(err.error_user_title) : "",
    err.error_user_msg ? String(err.error_user_msg) : "",
    err.error_data ? JSON.stringify(err.error_data) : "",
  ].filter(Boolean);
  return {
    code: `graph_${err.code ?? httpStatus}_${err.error_subcode ?? 0}`,
    message: parts.join(" | ").slice(0, 900),
  };
}

async function graphGet(
  token: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, any>> {
  const url = new URL(`${graphBase}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: "GET" });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || payload.error) {
    throw graphFailure(payload, response.status);
  }
  return payload;
}

async function graphUpload(
  token: string, path: string, field: string, bytes: Buffer,
  mimeType: string, filename: string, extra: Record<string, string> = {},
): Promise<Record<string, any>> {
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const response = await fetch(`${graphBase}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || payload.error) {
    throw graphFailure(payload, response.status);
  }
  return payload;
}

async function graphVideoRequest(
  token: string, base: string, path: string,
  fields: Record<string, string>, chunk?: Buffer,
): Promise<Record<string, any>> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (chunk) form.append("file_offset", new Blob([new Uint8Array(chunk)]));
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || payload.error) {
    throw graphFailure(payload, response.status);
  }
  return payload;
}

async function uploadVideoResumable(
  token: string, act: string, bytes: Buffer, title: string,
): Promise<{ id: string }> {
  const started = await graphVideoRequest(token, graphBase, `${act}/advideos`, {
    upload_phase: "start", file_size: String(bytes.length),
  });
  const sessionId = String(started.upload_session_id ?? "");
  const videoId = String(started.video_id ?? "");
  if (!sessionId || !videoId) {
    throw { code: "video_upload_session_failed", message: "Meta nao abriu a sessao de envio do video." } as GraphError;
  }
  let start = Number(started.start_offset ?? 0);
  let end = Number(started.end_offset ?? 0);
  let guard = 0;
  while (start < bytes.length) {
    guard += 1;
    if (guard > 100 || end <= start) {
      throw { code: "video_upload_stalled", message: "Envio do video nao avancou na Meta." } as GraphError;
    }
    const chunk = bytes.subarray(start, Math.min(end, bytes.length));
    const transferred = await graphVideoRequest(token, graphVideoBase, sessionId, {
      upload_phase: "transfer", start_offset: String(start),
    }, chunk);
    start = Number(transferred.start_offset ?? start + chunk.length);
    end = Number(transferred.end_offset ?? bytes.length);
  }
  await graphVideoRequest(token, graphVideoBase, sessionId, {
    upload_phase: "finish", title,
  });
  return { id: videoId };
}

function ctaType(cta: string | undefined): string {
  const normalized = (cta ?? "").toLowerCase();
  if (normalized.includes("comprar") || normalized.includes("shop")) return "SHOP_NOW";
  if (normalized.includes("cadastr") || normalized.includes("comecar") ||
      normalized.includes("começar") || normalized.includes("inscrev")) return "SIGN_UP";
  if (normalized.includes("baixar") || normalized.includes("download")) return "DOWNLOAD";
  if (normalized.includes("contato") || normalized.includes("whatsapp")) return "CONTACT_US";
  return "LEARN_MORE";
}

function metaEventType(event: string): string {
  const map: Record<string, string> = {
    Purchase: "PURCHASE",
    Lead: "LEAD",
    CompleteRegistration: "COMPLETE_REGISTRATION",
    InitiateCheckout: "INITIATE_CHECKOUT",
    ViewContent: "VIEW_CONTENT",
  };
  return map[event] ?? "PURCHASE";
}

function optimizationGoal(objective: string, hasPixel: boolean): string {
  switch (objective) {
    case "OUTCOME_TRAFFIC": return "LINK_CLICKS";
    case "OUTCOME_ENGAGEMENT": return "POST_ENGAGEMENT";
    case "OUTCOME_AWARENESS": return "REACH";
    case "OUTCOME_LEADS": return hasPixel ? "OFFSITE_CONVERSIONS" : "LEAD_GENERATION";
    default: return "OFFSITE_CONVERSIONS";
  }
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function processCampaignUploads(pool: pg.Pool) {
  const upload = await claim(pool);
  if (!upload) return { claimed: 0, completed: 0, failed: 0 };
  const config = upload.config ?? {};
  const adSetConfig = (config.adSet ?? {}) as Record<string, any>;
  try {
    const items = (await pool.query<ItemRow>(
      `select id, upload_id, account_external_id, level, name, creative_id,
              parent_item_id, external_id, status, copy, payload
         from public.campaign_upload_items
        where upload_id = $1
        order by case level when 'campaign' then 0 when 'adset' then 1 else 2 end,
                 created_at`,
      [upload.id])).rows;
    const byId = new Map(items.map((item) => [item.id, item]));

    // token por conta
    const tokens = new Map<string, string | null>();
    for (const externalId of new Set(items.map((i) => i.account_external_id))) {
      const account = (await pool.query<{ connection_id: string }>(
        `select connection_id from public.meta_ad_accounts
          where project_id = $1 and external_id = $2 limit 1`,
        [upload.project_id, externalId])).rows[0];
      tokens.set(externalId, account
        ? await loadMetaConnectionAccessToken(pool, account.connection_id)
        : null);
    }
    const r2 = await loadProjectR2Config(pool, upload.project_id);
    const storage = r2 ? new R2CreativeStorage(r2) : null;
    const mediaCache = new Map<string, { videoId?: string; imageHash?: string; imageUrl?: string }>();
    const bidStrategyFixed = new Set<string>();

    const markFailed = async (item: ItemRow, code: string, message: string) => {
      item.status = "failed";
      await pool.query(
        `update public.campaign_upload_items
            set status = 'failed', error_code = $2, error_message = $3, updated_at = now()
          where id = $1`, [item.id, code, message.slice(0, 500)]);
    };
    const markSkipped = async (item: ItemRow) => {
      item.status = "skipped";
      await pool.query(
        `update public.campaign_upload_items
            set status = 'skipped', error_code = 'parent_failed',
                error_message = 'Item pai nao foi criado.', updated_at = now()
          where id = $1`, [item.id]);
    };
    const markCreated = async (item: ItemRow, externalId: string) => {
      item.status = "created";
      item.external_id = externalId;
      await pool.query(
        `update public.campaign_upload_items
            set status = 'created', external_id = $2, error_code = null,
                error_message = null, updated_at = now()
          where id = $1`, [item.id, externalId]);
    };

    for (const item of items) {
      if (item.status === "created") continue;
      const token = tokens.get(item.account_external_id);
      if (!token) { await markFailed(item, "meta_token_missing", "Token Meta nao encontrado para a conta."); continue; }
      const parent = item.parent_item_id ? byId.get(item.parent_item_id) : null;
      if (item.level !== "campaign" && (!parent || parent.status !== "created" || !parent.external_id)) {
        await markSkipped(item);
        continue;
      }
      await pool.query(
        `update public.campaign_upload_items set status = 'creating', updated_at = now() where id = $1`,
        [item.id]);
      try {
        const act = item.account_external_id;
        if (item.level === "campaign") {
          const fields: Record<string, unknown> = {
            name: item.name,
            objective: String(item.payload?.objective ?? adSetConfig.objective ?? "OUTCOME_SALES"),
            status: "PAUSED",
            special_ad_categories: [],
            is_adset_budget_sharing_enabled: false,
            bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          };
          if (adSetConfig.budgetLevel === "campaign") {
            fields.daily_budget = Math.round(Number(adSetConfig.dailyBudget ?? 0) * 100);
          }
          const created = await graphPost(token, `${act}/campaigns`, fields);
          await markCreated(item, String(created.id));
        } else if (item.level === "adset") {
          // Campanhas criadas antes da correcao da estrategia de lance
          // nasceram com LOWEST_COST_WITH_BID_CAP, que exige bid_amount.
          // Ajusta para a estrategia sem teto, uma vez por campanha.
          if (parent?.external_id && !bidStrategyFixed.has(parent.id)) {
            bidStrategyFixed.add(parent.id);
            try {
              await graphPost(token, parent.external_id, {
                bid_strategy: "LOWEST_COST_WITHOUT_CAP",
              });
            } catch { /* campanha ativa ou ja ajustada: segue a criacao */ }
          }
          const payload = item.payload ?? {};
          const countries = String(payload.countries ?? "BR")
            .split(",").map((c) => c.trim()).filter(Boolean);
          const targeting: Record<string, unknown> = {
            geo_locations: { countries },
            targeting_automation: { advantage_audience: 0 },
          };
          if (Number(payload.ageMin) > 0) targeting.age_min = Number(payload.ageMin);
          if (Number(payload.ageMax) > 0) targeting.age_max = Number(payload.ageMax);
          if (payload.gender === "female") targeting.genders = [2];
          if (payload.gender === "male") targeting.genders = [1];
          const fields: Record<string, unknown> = {
            name: item.name,
            campaign_id: parent!.external_id,
            status: "PAUSED",
            billing_event: "IMPRESSIONS",
            optimization_goal: optimizationGoal(
              String(adSetConfig.objective ?? "OUTCOME_SALES"), Boolean(payload.pixelId)),
            targeting,
            start_time: new Date().toISOString(),
          };
          if (payload.budgetLevel !== "campaign") {
            fields.daily_budget = Math.round(Number(payload.dailyBudget ?? 0) * 100);
          }
          if (payload.pixelId) {
            fields.destination_type = "WEBSITE";
            fields.promoted_object = {
              pixel_id: String(payload.pixelId),
              custom_event_type: metaEventType(String(payload.event ?? "Purchase")),
            };
          }
          const created = await graphPost(token, `${act}/adsets`, fields);
          await markCreated(item, String(created.id));
        } else {
          // anuncio: sobe a midia (uma vez por conta e criativo), cria o
          // creative e o anuncio, tudo pausado.
          if (!item.creative_id) throw { code: "creative_missing", message: "Anuncio sem criativo." } as GraphError;
          if (!storage) throw { code: "r2_configuration_missing", message: "Armazenamento de criativos nao configurado." } as GraphError;
          const asset = (await pool.query<{ object_key: string; mime_type: string }>(
            `select asset.object_key, asset.mime_type
               from public.creatives creative
               join public.creative_versions version on version.id = creative.current_version_id
               join public.creative_assets asset on asset.id = version.asset_id
              where creative.id = $1 and creative.project_id = $2`,
            [item.creative_id, upload.project_id])).rows[0];
          if (!asset) throw { code: "creative_asset_missing", message: "Arquivo do criativo nao encontrado." } as GraphError;
          const cacheKey = `${act}:${item.creative_id}`;
          let media = mediaCache.get(cacheKey);
          if (!media) {
            const bytes = await streamToBuffer(
              await storage.getPrivateObject(asset.object_key));
            const isVideo = asset.mime_type.startsWith("video/");
            if (isVideo) {
              if (bytes.length > 1024 * 1024 * 1024) throw { code: "media_too_large", message: "Video acima de 1 GB." } as GraphError;
              const uploaded = await uploadVideoResumable(token, act, bytes, item.name);
              // A Meta exige miniatura no anuncio de video; ela e gerada
              // de forma assincrona, entao espera ate aparecer.
              let imageUrl = "";
              for (let attempt = 0; attempt < 9 && !imageUrl; attempt += 1) {
                const thumbs = await graphGet(token, `${uploaded.id}/thumbnails`,
                  { fields: "uri,is_preferred" }).catch(() => null);
                const list = (thumbs?.data ?? []) as Array<{ uri?: string; is_preferred?: boolean }>;
                const pick = list.find((entry) => entry.is_preferred) ?? list[0];
                if (pick?.uri) imageUrl = String(pick.uri);
                else await new Promise((resolve) => setTimeout(resolve, 10000));
              }
              if (!imageUrl) {
                throw { code: "video_thumbnail_pending", message: "Miniatura do video ainda nao foi gerada pela Meta; tente de novo em instantes." } as GraphError;
              }
              media = { videoId: String(uploaded.id), imageUrl };
            } else {
              const uploaded = await graphUpload(token, `${act}/adimages`, "filename",
                bytes, asset.mime_type, item.name);
              const images = (uploaded.images ?? {}) as Record<string, { hash?: string }>;
              const first = Object.values(images)[0];
              if (!first?.hash) throw { code: "image_hash_missing", message: "Meta nao devolveu o hash da imagem." } as GraphError;
              media = { imageHash: first.hash };
            }
            mediaCache.set(cacheKey, media);
          }
          const payload = item.payload ?? {};
          const copy = item.copy ?? { primaryText: "", headline: "", cta: "" };
          const destinationUrl = String(payload.destinationUrl ?? "");
          const storySpec: Record<string, unknown> = { page_id: String(payload.pageId ?? "") };
          if (payload.instagramId) storySpec.instagram_user_id = String(payload.instagramId);
          if (media.videoId) {
            storySpec.video_data = {
              video_id: media.videoId,
              image_url: media.imageUrl,
              message: copy.primaryText,
              title: copy.headline,
              call_to_action: { type: ctaType(copy.cta), value: { link: destinationUrl } },
            };
          } else {
            storySpec.link_data = {
              image_hash: media.imageHash,
              link: destinationUrl,
              message: copy.primaryText,
              name: copy.headline,
              call_to_action: { type: ctaType(copy.cta), value: { link: destinationUrl } },
            };
          }
          const creative = await graphPost(token, `${act}/adcreatives`, {
            name: item.name, object_story_spec: storySpec,
          });
          const ad = await graphPost(token, `${act}/ads`, {
            name: item.name,
            adset_id: parent!.external_id,
            creative: { creative_id: String(creative.id) },
            status: "PAUSED",
          });
          await markCreated(item, String(ad.id));
        }
      } catch (error) {
        const failure = error as GraphError;
        await markFailed(item,
          typeof failure?.code === "string" ? failure.code : "publish_failed",
          typeof failure?.message === "string" ? failure.message : "Erro desconhecido na publicacao.");
      }
    }

    // ativacao ao final, quando o modo de envio e ativo
    if (upload.send_mode === "active") {
      for (const item of items) {
        if (item.status !== "created" || !item.external_id) continue;
        const token = tokens.get(item.account_external_id);
        if (!token) continue;
        try {
          await graphPost(token, item.external_id, { status: "ACTIVE" });
        } catch { /* fica pausado; o item ja esta criado */ }
      }
    }

    const createdCount = items.filter((i) => i.status === "created").length;
    const failedCount = items.filter((i) => i.status === "failed" || i.status === "skipped").length;
    const finalStatus = createdCount === 0 ? "failed"
      : failedCount > 0 ? "partial" : "completed";
    await pool.query(
      `update public.campaign_uploads
          set status = $2, finished_at = now(), updated_at = now(),
              summary = summary || $3::jsonb
        where id = $1`,
      [upload.id, finalStatus, JSON.stringify({
        createdItems: createdCount, failedItems: failedCount, totalItems: items.length,
      })]);
    return { claimed: 1, completed: createdCount, failed: failedCount };
  } catch (error) {
    await pool.query(
      `update public.campaign_uploads
          set status = 'failed', finished_at = now(), updated_at = now(),
              error_code = 'publish_cycle_failed',
              error_message = $2
        where id = $1`,
      [upload.id, error instanceof Error ? error.message.slice(0, 500) : "Erro desconhecido."]);
    return { claimed: 1, completed: 0, failed: 1 };
  }
}

