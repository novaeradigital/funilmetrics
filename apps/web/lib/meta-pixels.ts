// Configuracao de pixel Meta por projeto de negocio (business_meta_pixels).
// O jsonb `config` segue o espelho das configuracoes do checkout
// (PlatformPixelSetting): eventos ativos, correspondencia avancada, regra de
// valor, content_ids e IPs bloqueados. A API de tracking le `events` e
// `blockIps` ao enfileirar; o worker le o restante ao montar o Purchase.

export type MetaPixelSettings = {
  events: {
    pageView: boolean;
    viewContent: boolean;
    initiateCheckout: boolean;
    purchase: boolean;
    refund: boolean;
  };
  matching: {
    email: boolean;
    phone: boolean;
    firstName: boolean;
    lastName: boolean;
    city: boolean;
    state: boolean;
    zip: boolean;
    externalId: boolean;
    ip: boolean;
    userAgent: boolean;
  };
  valueRule: "paid" | "full" | "fixed" | "percent";
  valueFixed: number | null;
  valuePercent: number | null;
  contentIdsType: "sku" | "product" | "custom";
  contentIdsCustom: string | null;
  blockIps: string[];
};

export const metaPixelSettingsDefaults: MetaPixelSettings = {
  events: {
    pageView: true,
    viewContent: true,
    initiateCheckout: true,
    purchase: true,
    refund: false,
  },
  matching: {
    email: true,
    phone: true,
    firstName: true,
    lastName: true,
    city: true,
    state: true,
    zip: true,
    externalId: true,
    ip: true,
    userAgent: true,
  },
  valueRule: "paid",
  valueFixed: null,
  valuePercent: null,
  contentIdsType: "product",
  contentIdsCustom: null,
  blockIps: [],
};

function boolMap<T extends Record<string, boolean>>(
  defaults: T,
  raw: unknown,
): T {
  const out = { ...defaults };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const value = (raw as Record<string, unknown>)[key as string];
      if (typeof value === "boolean") out[key] = value as T[keyof T];
    }
  }
  return out;
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function metaPixelSettings(raw: unknown): MetaPixelSettings {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const valueRule = ["paid", "full", "fixed", "percent"].includes(
    String(source.valueRule),
  )
    ? (String(source.valueRule) as MetaPixelSettings["valueRule"])
    : metaPixelSettingsDefaults.valueRule;
  const contentIdsType = ["sku", "product", "custom"].includes(
    String(source.contentIdsType),
  )
    ? (String(source.contentIdsType) as MetaPixelSettings["contentIdsType"])
    : metaPixelSettingsDefaults.contentIdsType;
  const blockIps = Array.isArray(source.blockIps)
    ? source.blockIps.filter(
        (ip): ip is string => typeof ip === "string" && ip.trim().length > 0,
      )
    : [];
  return {
    events: boolMap(metaPixelSettingsDefaults.events, source.events),
    matching: boolMap(metaPixelSettingsDefaults.matching, source.matching),
    valueRule,
    valueFixed: numberOrNull(source.valueFixed),
    valuePercent: numberOrNull(source.valuePercent),
    contentIdsType,
    contentIdsCustom:
      typeof source.contentIdsCustom === "string" &&
      source.contentIdsCustom.trim()
        ? source.contentIdsCustom.trim()
        : null,
    blockIps,
  };
}

export type BusinessMetaPixelRow = {
  business_project_id: string;
  business_name: string;
  pixel_id: string | null;
  active: boolean;
  mode: string;
  test_event_code: string | null;
  event_id_prefix: string;
  settings: MetaPixelSettings;
  has_token: boolean;
};

type Db = {
  pool: {
    query: <T extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) => Promise<{ rows: T[]; rowCount: number | null }>;
  };
};

export async function loadBusinessMetaPixels(
  db: Db,
  projectId: string,
): Promise<BusinessMetaPixelRow[]> {
  const result = await db.pool.query<{
    business_project_id: string;
    business_name: string;
    pixel_id: string | null;
    active: boolean | null;
    mode: string | null;
    test_event_code: string | null;
    event_id_prefix: string | null;
    config: unknown;
    has_token: boolean;
  }>(
    `select b.id::text as business_project_id, b.name as business_name,
            p.pixel_id, p.active, p.mode, p.test_event_code,
            p.event_id_prefix, p.config,
            exists(
              select 1 from public.integration_secrets s
               where s.project_id = b.project_id
                 and s.provider = 'meta_capi'
                 and s.kind = 'capi_token:' || b.id::text
                 and s.rotated_at is null
            ) as has_token
       from public.business_projects b
       left join public.business_meta_pixels p
         on p.business_project_id = b.id and p.project_id = b.project_id
      where b.project_id = $1
      order by b.name`,
    [projectId],
  );
  return result.rows.map((row) => ({
    business_project_id: row.business_project_id,
    business_name: row.business_name,
    pixel_id: row.pixel_id,
    active: row.active ?? true,
    mode: row.mode ?? "api",
    test_event_code: row.test_event_code,
    event_id_prefix: row.event_id_prefix ?? "fm-",
    settings: metaPixelSettings(row.config),
    has_token: row.has_token,
  }));
}

export type MetaQueueRow = {
  id: string;
  created_at: string;
  business_name: string | null;
  pixel_id: string;
  event_name: string;
  event_id: string;
  event_time: string;
  status: string;
  attempts: number;
  value: string | null;
  last_error: string | null;
  blocked_reason: string | null;
  sent_at: string | null;
};

export async function loadMetaEventQueue(
  db: Db,
  projectId: string,
  status: string | undefined,
  limit = 100,
): Promise<{ rows: MetaQueueRow[]; counts: Record<string, number> }> {
  const countsResult = await db.pool.query<{ status: string; total: number }>(
    `select status, count(*)::int as total
       from public.meta_event_queue
      where project_id = $1
      group by status`,
    [projectId],
  );
  const counts: Record<string, number> = {};
  for (const row of countsResult.rows) counts[row.status] = row.total;

  const rowsResult = await db.pool.query<MetaQueueRow>(
    `select q.id::text as id, q.created_at::text as created_at,
            b.name as business_name, q.pixel_id, q.event_name, q.event_id,
            q.event_time::text as event_time, q.status, q.attempts,
            q.custom_data->>'value' as value, q.last_error,
            q.blocked_reason, q.sent_at::text as sent_at
       from public.meta_event_queue q
       left join public.business_projects b on b.id = q.business_project_id
      where q.project_id = $1
        and ($2::text is null or q.status = $2)
      order by q.created_at desc
      limit $3`,
    [projectId, status ?? null, limit],
  );
  return { rows: rowsResult.rows, counts };
}
