import type pg from "pg";
import { loadMetaCapiToken } from "./integration-credentials.js";

// Despachante da fila de eventos Meta (meta_event_queue): a linha da fila ja
// nasce com user_data e custom_data montados em formato CAPI (espelho do
// PixelEventLog do ConfigCheckout); aqui so reivindicamos, enviamos para a
// Graph API e registramos o resultado na propria linha.

export type MetaQueueRow = {
  id: string;
  organization_id: string;
  project_id: string;
  business_project_id: string | null;
  pixel_id: string;
  event_name: string;
  event_id: string;
  event_time: Date | string;
  event_source_url: string | null;
  user_data: Record<string, unknown>;
  custom_data: Record<string, unknown>;
  attempts: number;
};

type PixelConfigRow = {
  active: boolean;
  test_event_code: string | null;
};

export function buildMetaEventPayload(
  row: Pick<
    MetaQueueRow,
    | "event_name"
    | "event_time"
    | "event_id"
    | "event_source_url"
    | "user_data"
    | "custom_data"
  >,
  testEventCode?: string | null,
) {
  const event: Record<string, unknown> = {
    event_name: row.event_name,
    event_time: Math.floor(new Date(row.event_time).getTime() / 1000),
    event_id: row.event_id,
    action_source: "website",
  };
  if (row.event_source_url) event.event_source_url = row.event_source_url;
  if (row.user_data && Object.keys(row.user_data).length > 0) {
    event.user_data = row.user_data;
  }
  if (row.custom_data && Object.keys(row.custom_data).length > 0) {
    event.custom_data = row.custom_data;
  }
  const payload: Record<string, unknown> = { data: [event] };
  if (testEventCode) payload.test_event_code = testEventCode;
  return payload;
}

type DispatcherDeps = {
  fetchImpl?: typeof fetch;
  loadToken?: (
    pool: pg.Pool,
    projectId: string,
    businessProjectId: string,
  ) => Promise<string | null>;
};

async function markRow(
  pool: pg.Pool,
  row: MetaQueueRow,
  status: "sent" | "failed" | "dead" | "blocked",
  detail: { error?: string; response?: unknown; blockedReason?: string },
) {
  await pool.query(
    `update public.meta_event_queue
        set status = $2,
            last_error = $3,
            response = $4::jsonb,
            blocked_reason = $5,
            sent_at = case when $2 = 'sent' then now() else sent_at end
      where id = $1`,
    [
      row.id,
      status,
      detail.error ?? null,
      detail.response === undefined ? null : JSON.stringify(detail.response),
      detail.blockedReason ?? null,
    ],
  );
}

export async function processMetaEventBatch(
  pool: pg.Pool,
  limit = 25,
  maxAttempts = 5,
  deps: DispatcherDeps = {},
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const loadToken = deps.loadToken ?? loadMetaCapiToken;

  const claimed = await pool.query<MetaQueueRow>(
    `with candidates as (
       select id
         from public.meta_event_queue
        where status in ('pending', 'failed')
          and attempts < $2
        order by
          case when status = 'pending' then 0 else 1 end,
          created_at
        for update skip locked
        limit $1
     )
     update public.meta_event_queue queue
        set status = 'processing',
            attempts = attempts + 1
       from candidates
      where queue.id = candidates.id
      returning
        queue.id, queue.organization_id, queue.project_id,
        queue.business_project_id, queue.pixel_id, queue.event_name,
        queue.event_id, queue.event_time, queue.event_source_url,
        queue.user_data, queue.custom_data, queue.attempts`,
    [limit, maxAttempts],
  );

  const summary = {
    claimed: claimed.rowCount ?? 0,
    sent: 0,
    failed: 0,
    dead: 0,
    blocked: 0,
  };

  for (const row of claimed.rows) {
    const exhausted = row.attempts >= maxAttempts;
    try {
      if (!row.business_project_id) {
        await markRow(pool, row, "dead", {
          error: "Evento sem projeto de negocio vinculado.",
        });
        summary.dead += 1;
        continue;
      }

      const configResult = await pool.query<PixelConfigRow>(
        `select active, test_event_code
           from public.business_meta_pixels
          where business_project_id = $1 and project_id = $2
          limit 1`,
        [row.business_project_id, row.project_id],
      );
      const config = configResult.rows[0];
      if (!config) {
        await markRow(pool, row, "dead", {
          error: "Configuracao de pixel do negocio nao encontrada.",
        });
        summary.dead += 1;
        continue;
      }
      if (!config.active) {
        await markRow(pool, row, "blocked", {
          blockedReason: "pixel_inativo",
          error: "Pixel do negocio esta inativo.",
        });
        summary.blocked += 1;
        continue;
      }

      const token = await loadToken(
        pool,
        row.project_id,
        row.business_project_id,
      );
      if (!token) {
        throw new Error("token_capi_ausente");
      }

      const payload = buildMetaEventPayload(row, config.test_event_code);
      const response = await fetchImpl(
        `https://graph.facebook.com/v21.0/${row.pixel_id}/events?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const responseText = await response.text();
      let responseJson: unknown = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        responseJson = { raw: responseText.slice(0, 1000) };
      }
      if (!response.ok) {
        const message =
          responseJson &&
          typeof responseJson === "object" &&
          "error" in responseJson
            ? String(
                (responseJson as { error?: { message?: unknown } }).error
                  ?.message ?? `HTTP ${response.status}`,
              )
            : `HTTP ${response.status}`;
        throw Object.assign(new Error(message), { responseJson });
      }

      await markRow(pool, row, "sent", { response: responseJson });
      summary.sent += 1;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 500) : "erro_desconhecido";
      const responseJson =
        error && typeof error === "object" && "responseJson" in error
          ? (error as { responseJson: unknown }).responseJson
          : undefined;
      if (exhausted) {
        await markRow(pool, row, "dead", { error: message, response: responseJson });
        summary.dead += 1;
      } else {
        await markRow(pool, row, "failed", {
          error: message,
          response: responseJson,
        });
        summary.failed += 1;
      }
    }
  }

  return summary;
}
