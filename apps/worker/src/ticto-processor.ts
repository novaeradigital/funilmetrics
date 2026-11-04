import type pg from "pg";
import { createHash } from "node:crypto";
import {
  TictoNormalizationBlocked,
  normalizeTictoEvent,
  type NormalizedTictoEvent,
} from "./ticto-normalizer.js";

type RawCandidate = {
  id: string;
  organization_id: string;
  project_id: string;
  connection_id: string;
  external_event_id: string | null;
  idempotency_key: string;
  received_at: Date;
  body_json: unknown;
  processing_attempts: number;
};

const orderRank = {
  abandoned: 0,
  pending: 1,
  expired: 2,
  cancelled: 2,
  approved: 3,
  refund_requested: 4,
  refunded: 5,
  chargeback: 5,
} as const;

const paymentRank = {
  pending: 1,
  expired: 2,
  cancelled: 2,
  approved: 3,
  refund_requested: 4,
  refunded: 5,
  chargeback: 5,
} as const;

export function advanceOrderStatus(
  current: keyof typeof orderRank,
  incoming: keyof typeof orderRank,
) {
  return orderRank[incoming] >= orderRank[current] ? incoming : current;
}

export function advancePaymentStatus(
  current: keyof typeof paymentRank,
  incoming: keyof typeof paymentRank,
) {
  return paymentRank[incoming] >= paymentRank[current] ? incoming : current;
}

export function calculateFinancialEffect(input: {
  scope: "production" | "test" | "unknown";
  intent: "approve" | "reverse" | "none";
  amount?: number;
  hasExternalPaymentId: boolean;
  existingPositive: number;
  existingNegative: number;
}) {
  if (
    input.scope !== "production" ||
    !input.hasExternalPaymentId ||
    input.amount === undefined
  ) {
    return { effect: 0, duplicate: false };
  }

  if (input.intent === "approve" && input.existingPositive === 0) {
    return { effect: input.amount, duplicate: false };
  }
  if (input.intent === "reverse" && input.existingNegative === 0) {
    return { effect: -input.amount, duplicate: false };
  }
  return {
    effect: 0,
    duplicate: input.intent !== "none",
  };
}

function money(value: number | undefined) {
  return value === undefined ? null : value.toFixed(2);
}

async function resolvePerson(
  client: pg.PoolClient,
  raw: RawCandidate,
  normalized: ReturnType<typeof normalizeTictoEvent>,
) {
  const personIds = new Set<string>();

  for (const identifier of normalized.person.identifiers) {
    const result = await client.query<{ person_id: string }>(
      `select person_id
         from public.person_identifiers
        where organization_id = $1
          and project_id = $2
          and data_scope = $3
          and type = $4
          and normalized_value = $5`,
      [
        raw.organization_id,
        raw.project_id,
        normalized.scope,
        identifier.type,
        identifier.normalizedValue,
      ],
    );
    for (const row of result.rows) personIds.add(row.person_id);
  }

  if (personIds.size > 1) {
    throw new TictoNormalizationBlocked(
      "ambiguous_identity",
      "Identificadores apontam para pessoas diferentes.",
    );
  }

  let personId = [...personIds][0];
  if (!personId) {
    const inserted = await client.query<{ id: string }>(
      `insert into public.people (
         organization_id, project_id, data_scope, display_name
       )
       values ($1, $2, $3, $4)
       returning id`,
      [
        raw.organization_id,
        raw.project_id,
        normalized.scope,
        normalized.person.displayName ?? null,
      ],
    );
    personId = inserted.rows[0]!.id;
  } else if (normalized.person.displayName) {
    await client.query(
      `update public.people
          set display_name = coalesce(display_name, $2),
              updated_at = now()
        where id = $1`,
      [personId, normalized.person.displayName],
    );
  }

  for (const identifier of normalized.person.identifiers) {
    await client.query(
      `insert into public.person_identifiers (
         organization_id, project_id, person_id, connection_id,
         data_scope, type, normalized_value, raw_value
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (
         organization_id, project_id, data_scope, type, normalized_value
       ) do nothing`,
      [
        raw.organization_id,
        raw.project_id,
        personId,
        raw.connection_id,
        normalized.scope,
        identifier.type,
        identifier.normalizedValue,
        identifier.rawValue ?? null,
      ],
    );
  }

  return personId;
}


function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

type MetaSettings = {
  events: { purchase: boolean; refund: boolean };
  matching: Record<string, boolean>;
  valueRule: string;
  valueFixed: number | null;
  valuePercent: number | null;
  contentIdsType: string;
  contentIdsCustom: string | null;
  blockIps: string[];
};

function metaSettingsFrom(raw: unknown): MetaSettings {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const events = (source.events ?? {}) as Record<string, unknown>;
  const matchingRaw = (source.matching ?? {}) as Record<string, unknown>;
  const matching: Record<string, boolean> = {};
  for (const key of [
    "email", "phone", "firstName", "lastName", "city",
    "state", "zip", "externalId", "ip", "userAgent",
  ]) {
    matching[key] = matchingRaw[key] !== false;
  }
  return {
    events: {
      purchase: events.purchase !== false,
      refund: events.refund === true,
    },
    matching,
    valueRule: typeof source.valueRule === "string" ? source.valueRule : "paid",
    valueFixed: typeof source.valueFixed === "number" ? source.valueFixed : null,
    valuePercent:
      typeof source.valuePercent === "number" ? source.valuePercent : null,
    contentIdsType:
      typeof source.contentIdsType === "string" ? source.contentIdsType : "product",
    contentIdsCustom:
      typeof source.contentIdsCustom === "string" ? source.contentIdsCustom : null,
    blockIps: Array.isArray(source.blockIps)
      ? source.blockIps.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  };
}

// Enfileira o evento Meta da venda (Purchase/Refund) na mesma transacao da
// normalizacao. O event_id deterministico por pedido + o unique da fila
// garantem uma unica copia mesmo com reprocessamento.
async function enqueueMetaSaleEvent(
  client: pg.PoolClient,
  raw: RawCandidate,
  normalized: NormalizedTictoEvent,
  orderId: string,
  productIds: string[],
) {
  const isPurchase = normalized.normalizedType === "payment_approved";
  const isRefund =
    normalized.normalizedType === "payment_refunded" ||
    normalized.normalizedType === "payment_chargeback";
  if ((!isPurchase && !isRefund) || normalized.scope !== "production") return;

  const businessResult = await client.query<{ business_id: string | null }>(
    `select coalesce(
       (select business_project_id from public.commerce_products where id = $1),
       (select business_project_id from public.connections where id = $2)
     )::text as business_id`,
    [productIds[0] ?? null, raw.connection_id],
  );
  const businessId = businessResult.rows[0]?.business_id;
  if (!businessId) return;

  const pixelResult = await client.query<{
    pixel_id: string;
    active: boolean;
    mode: string;
    event_id_prefix: string;
    config: unknown;
  }>(
    `select pixel_id, active, mode, event_id_prefix, config
       from public.business_meta_pixels
      where business_project_id = $1 and project_id = $2
      limit 1`,
    [businessId, raw.project_id],
  );
  const pixel = pixelResult.rows[0];
  if (!pixel || !pixel.active || pixel.mode === "off" || pixel.mode === "browser") {
    return;
  }
  const settings = metaSettingsFrom(pixel.config);
  if (isPurchase && !settings.events.purchase) return;
  if (isRefund && !settings.events.refund) return;

  let value: number | undefined;
  if (settings.valueRule === "full") {
    value = normalized.originalAmount ?? normalized.paidAmount;
  } else if (settings.valueRule === "fixed") {
    value = settings.valueFixed ?? undefined;
  } else if (settings.valueRule === "percent") {
    value =
      normalized.paidAmount !== undefined && settings.valuePercent !== null
        ? (normalized.paidAmount * settings.valuePercent) / 100
        : undefined;
  } else {
    value = normalized.paidAmount;
  }
  if (value === undefined || !Number.isFinite(value)) return;
  value = Math.round(value * 100) / 100;

  const visitorResult = await client.query<{
    fbp: string | null;
    fbc: string | null;
    client_ip: string | null;
    user_agent: string | null;
    first_url: string | null;
    visitor_id: string;
  }>(
    `select v.fbp, v.fbc, v.client_ip, v.user_agent, v.first_url,
            tc.visitor_id
       from public.tracking_conversions tc
       join public.tracking_visitors v
         on v.tracking_source_id = tc.tracking_source_id
        and v.visitor_id = tc.visitor_id
      where tc.order_id = $1
      limit 1`,
    [orderId],
  );
  const visitor = visitorResult.rows[0];

  const match = settings.matching;
  const userData: Record<string, unknown> = {};
  const emailId = normalized.person.identifiers.find(
    (identifier) => identifier.type === "email",
  );
  const phoneId = normalized.person.identifiers.find(
    (identifier) => identifier.type === "phone",
  );
  if (match.email && emailId) {
    userData.em = [sha256Hex(emailId.normalizedValue.trim().toLowerCase())];
  }
  if (match.phone && phoneId) {
    let digits = phoneId.normalizedValue.replace(/\D/g, "");
    if (digits.length <= 11) digits = `55${digits}`;
    userData.ph = [sha256Hex(digits)];
  }
  const nameParts = (normalized.person.displayName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (match.firstName && nameParts.length) {
    userData.fn = [sha256Hex(nameParts[0]!.toLowerCase())];
  }
  if (match.lastName && nameParts.length > 1) {
    userData.ln = [sha256Hex(nameParts.slice(1).join(" ").toLowerCase())];
  }
  const address = normalized.buyerAddress;
  if (address) {
    if (match.city && address.city) {
      userData.ct = [
        sha256Hex(address.city.trim().toLowerCase().replace(/\s+/g, "")),
      ];
    }
    if (match.state && address.state) {
      userData.st = [sha256Hex(address.state.trim().toLowerCase())];
    }
    if (match.zip && address.zip) {
      userData.zp = [sha256Hex(address.zip.replace(/\D/g, ""))];
    }
    if (address.country) {
      userData.country = [sha256Hex(address.country.trim().toLowerCase())];
    }
  }
  if (match.externalId && emailId) {
    userData.external_id = [
      sha256Hex(`comprador-${emailId.normalizedValue.trim().toLowerCase()}`),
    ];
  }
  if (visitor) {
    if (visitor.fbp) userData.fbp = visitor.fbp;
    if (visitor.fbc) userData.fbc = visitor.fbc;
    if (match.ip && visitor.client_ip) {
      userData.client_ip_address = visitor.client_ip;
    }
    if (match.userAgent && visitor.user_agent) {
      userData.client_user_agent = visitor.user_agent;
    }
  }

  const contentIds =
    settings.contentIdsType === "sku"
      ? [normalized.offer.externalId]
      : settings.contentIdsType === "custom" && settings.contentIdsCustom
        ? [settings.contentIdsCustom]
        : normalized.products.map((product) => product.externalId);
  const customData: Record<string, unknown> = {
    value,
    currency: "BRL",
    content_ids: contentIds,
    content_type: "product",
    content_name: normalized.products[0]?.name,
    order_id: normalized.orderExternalKey,
  };

  const blocked = Boolean(
    visitor?.client_ip && settings.blockIps.includes(visitor.client_ip),
  );
  await client.query(
    `insert into public.meta_event_queue(
       organization_id, project_id, business_project_id, pixel_id,
       event_name, event_id, event_time, event_source_url, visitor_id,
       order_id, user_data, custom_data, status, blocked_reason)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
     on conflict (pixel_id, event_id) do nothing`,
    [
      raw.organization_id,
      raw.project_id,
      businessId,
      pixel.pixel_id,
      isPurchase ? "Purchase" : "Refund",
      `${pixel.event_id_prefix}${isPurchase ? "purchase" : "refund"}-${orderId}`,
      normalized.occurredAt,
      visitor?.first_url ?? null,
      visitor?.visitor_id ?? null,
      orderId,
      JSON.stringify(userData),
      JSON.stringify(customData),
      blocked ? "blocked" : "pending",
      blocked ? "ip_excluido" : null,
    ],
  );
}

async function processCandidate(
  pool: pg.Pool,
  raw: RawCandidate,
  maxAttempts: number,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const duplicate = await client.query(
      `select id
         from public.normalized_payment_events
        where raw_event_id = $1`,
      [raw.id],
    );
    if (duplicate.rowCount) {
      await client.query(
        `update public.raw_events
            set processing_status = 'normalized',
                error_code = null,
                error_message = null
          where id = $1`,
        [raw.id],
      );
      await client.query("commit");
      return "duplicate";
    }

    const normalized = normalizeTictoEvent({
      rawEventId: raw.id,
      externalEventId: raw.external_event_id,
      idempotencyKey: raw.idempotency_key,
      receivedAt: raw.received_at,
      body: raw.body_json,
    });
    const personId = await resolvePerson(client, raw, normalized);

    const offer = await client.query<{ id: string }>(
      `insert into public.commerce_offers (
         organization_id, project_id, connection_id, data_scope,
         external_id, name, url
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (connection_id, data_scope, external_id)
       do update set
         name = excluded.name,
         url = coalesce(excluded.url, commerce_offers.url),
         updated_at = now()
       returning id`,
      [
        raw.organization_id,
        raw.project_id,
        raw.connection_id,
        normalized.scope,
        normalized.offer.externalId,
        normalized.offer.name,
        normalized.offer.url ?? null,
      ],
    );

    const productIds: string[] = [];
    for (const product of normalized.products) {
      const result = await client.query<{ id: string }>(
        `insert into public.commerce_products (
           organization_id, project_id, connection_id, data_scope,
           external_id, name
         )
         values ($1, $2, $3, $4, $5, $6)
         on conflict (connection_id, data_scope, external_id)
         do update set name = excluded.name, updated_at = now()
         returning id`,
        [
          raw.organization_id,
          raw.project_id,
          raw.connection_id,
          normalized.scope,
          product.externalId,
          product.name,
        ],
      );
      productIds.push(result.rows[0]!.id);
    }

    const existingOrder = await client.query<{
      id: string;
      status: keyof typeof orderRank;
    }>(
      `select id, status
         from public.commerce_orders
        where connection_id = $1
          and data_scope = $2
          and external_key = $3
        for update`,
      [
        raw.connection_id,
        normalized.scope,
        normalized.orderExternalKey,
      ],
    );

    let orderId: string;
    if (!existingOrder.rowCount) {
      const inserted = await client.query<{ id: string }>(
        `insert into public.commerce_orders (
           organization_id, project_id, connection_id, person_id, offer_id,
           data_scope, external_key, status, original_amount, paid_amount,
           occurred_at, occurred_at_raw, occurred_at_basis
         )
         values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
         )
         returning id`,
        [
          raw.organization_id,
          raw.project_id,
          raw.connection_id,
          personId,
          offer.rows[0]!.id,
          normalized.scope,
          normalized.orderExternalKey,
          normalized.orderStatus,
          money(normalized.originalAmount),
          money(normalized.paidAmount),
          normalized.occurredAt,
          normalized.occurredAtRaw ?? null,
          normalized.occurredAtBasis,
        ],
      );
      orderId = inserted.rows[0]!.id;
    } else {
      const current = existingOrder.rows[0]!;
      orderId = current.id;
      const nextStatus = advanceOrderStatus(
        current.status,
        normalized.orderStatus,
      );
      await client.query(
        `update public.commerce_orders
            set person_id = coalesce(person_id, $2),
                offer_id = coalesce(offer_id, $3),
                status = $4,
                original_amount = coalesce($5, original_amount),
                paid_amount = coalesce($6, paid_amount),
                updated_at = now()
          where id = $1`,
        [
          orderId,
          personId,
          offer.rows[0]!.id,
          nextStatus,
          money(normalized.originalAmount),
          money(normalized.paidAmount),
        ],
      );
    }

    for (const productId of productIds) {
      await client.query(
        `insert into public.commerce_order_items (
           organization_id, project_id, order_id, product_id
         )
         values ($1, $2, $3, $4)
         on conflict (order_id, product_id) do nothing`,
        [raw.organization_id, raw.project_id, orderId, productId],
      );
    }

    let paymentId: string | null = null;
    if (normalized.payment) {
      const existingPayment = await client.query<{
        id: string;
        status: keyof typeof paymentRank;
      }>(
        normalized.payment.externalPaymentId
          ? `select id, status
               from public.payments
              where connection_id = $1
                and data_scope = $2
                and external_payment_id = $3
              for update`
          : `select id, status
               from public.payments
              where order_id = $1
              for update`,
        normalized.payment.externalPaymentId
          ? [
              raw.connection_id,
              normalized.scope,
              normalized.payment.externalPaymentId,
            ]
          : [orderId],
      );

      if (!existingPayment.rowCount) {
        const inserted = await client.query<{ id: string }>(
          `insert into public.payments (
             organization_id, project_id, connection_id, order_id, data_scope,
             external_payment_id, status, method, installments
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            raw.organization_id,
            raw.project_id,
            raw.connection_id,
            orderId,
            normalized.scope,
            normalized.payment.externalPaymentId ?? null,
            normalized.payment.status,
            normalized.payment.method ?? null,
            normalized.payment.installments ?? null,
          ],
        );
        paymentId = inserted.rows[0]!.id;
      } else {
        const current = existingPayment.rows[0]!;
        paymentId = current.id;
        const nextStatus = advancePaymentStatus(
          current.status,
          normalized.payment.status,
        );
        await client.query(
          `update public.payments
              set status = $2,
                  method = coalesce(method, $3),
                  installments = coalesce(installments, $4),
                  updated_at = now()
            where id = $1`,
          [
            paymentId,
            nextStatus,
            normalized.payment.method ?? null,
            normalized.payment.installments ?? null,
          ],
        );
      }
    }

    let financialEffect = 0;
    let producerCommissionFinancialEffect = 0;
    if (
      normalized.scope === "production" &&
      paymentId &&
      normalized.payment?.externalPaymentId &&
      normalized.paidAmount !== undefined
    ) {
      const effects = await client.query<{
        positive: string;
        negative: string;
        commission_positive: string;
        commission_negative: string;
      }>(
        `select
           coalesce(sum(financial_effect) filter (
             where financial_effect > 0
           ), 0)::text as positive,
           coalesce(sum(financial_effect) filter (
             where financial_effect < 0
           ), 0)::text as negative,
           coalesce(sum(producer_commission_financial_effect) filter (
             where producer_commission_financial_effect > 0
           ), 0)::text as commission_positive,
           coalesce(sum(producer_commission_financial_effect) filter (
             where producer_commission_financial_effect < 0
           ), 0)::text as commission_negative
         from public.normalized_payment_events
        where payment_id = $1`,
        [paymentId],
      );
      const positive = Number(effects.rows[0]?.positive ?? 0);
      const negative = Number(effects.rows[0]?.negative ?? 0);

      const calculation = calculateFinancialEffect({
        scope: normalized.scope,
        intent: normalized.financialIntent,
        amount: normalized.paidAmount,
        hasExternalPaymentId: true,
        existingPositive: positive,
        existingNegative: negative,
      });
      financialEffect = calculation.effect;
      if (calculation.duplicate) {
        normalized.warnings.push("equivalent_financial_effect_already_applied");
      }

      const commissionCalculation = calculateFinancialEffect({
        scope: normalized.scope,
        intent: normalized.financialIntent,
        amount: normalized.producerCommissionAmount,
        hasExternalPaymentId: true,
        existingPositive: Number(effects.rows[0]?.commission_positive ?? 0),
        existingNegative: Number(effects.rows[0]?.commission_negative ?? 0),
      });
      producerCommissionFinancialEffect = commissionCalculation.effect;
    }

    await client.query(
      `insert into public.normalized_payment_events (
         organization_id, project_id, raw_event_id, order_id, payment_id,
         data_scope, type, external_event_name, amount, financial_effect,
         sale_amount, sale_financial_effect, producer_commission_amount,
         producer_commission_financial_effect, commission_data_status,
         occurred_at, occurred_at_raw, occurred_at_basis, rule_version, warnings
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
       )`,
      [
        raw.organization_id,
        raw.project_id,
        raw.id,
        orderId,
        paymentId,
        normalized.scope,
        normalized.normalizedType,
        normalized.externalEventName,
        money(normalized.paidAmount),
        financialEffect.toFixed(2),
        money(normalized.paidAmount),
        financialEffect.toFixed(2),
        money(normalized.producerCommissionAmount),
        producerCommissionFinancialEffect.toFixed(2),
        normalized.producerCommissionAmount === undefined ? "missing" : "complete",
        normalized.occurredAt,
        normalized.occurredAtRaw ?? null,
        normalized.occurredAtBasis,
        normalized.ruleVersion,
        JSON.stringify(normalized.warnings),
      ],
    );

    await client.query(
      `insert into public.order_attributions (
         organization_id, project_id, raw_event_id, order_id,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content, utm_id,
         src, sck, vtid, origin_url
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       )
       on conflict (raw_event_id) do nothing`,
      [
        raw.organization_id,
        raw.project_id,
        raw.id,
        orderId,
        normalized.attribution.utmSource ?? null,
        normalized.attribution.utmMedium ?? null,
        normalized.attribution.utmCampaign ?? null,
        normalized.attribution.utmTerm ?? null,
        normalized.attribution.utmContent ?? null,
        normalized.attribution.utmId ?? null,
        normalized.attribution.src ?? null,
        normalized.attribution.sck ?? null,
        normalized.attribution.vtid ?? null,
        normalized.attribution.originUrl ?? null,
      ],
    );

    const experimentToken=normalized.attribution.sck;
    if(experimentToken?.startsWith("fm_")&&/^fm_[a-f0-9]{32}$/.test(experimentToken)){
      await client.query(
        `insert into public.experiment_conversions(
           organization_id,project_id,experiment_id,variant_id,exposure_id,order_id
         )
         select exposure.organization_id,exposure.project_id,exposure.experiment_id,
                exposure.variant_id,exposure.id,$1
           from public.experiment_exposures exposure
          where exposure.project_id=$2 and exposure.tracking_token=$3
         on conflict(order_id) do update set last_observed_at=now()`,
        [orderId,raw.project_id,experimentToken],
      );
    }
    if(experimentToken?.startsWith("fmt_")&&/^fmt_[a-f0-9]{32}$/.test(experimentToken)){
      const visitorId=`${experimentToken.slice(4,12)}-${experimentToken.slice(12,16)}-${experimentToken.slice(16,20)}-${experimentToken.slice(20,24)}-${experimentToken.slice(24)}`;
      await client.query(
        `insert into public.tracking_conversions(organization_id,project_id,
           tracking_source_id,visitor_id,order_id)
         select event.organization_id,event.project_id,event.tracking_source_id,$1,$2
         from public.tracking_events event
         where event.project_id=$3 and event.visitor_id=$1 and not event.is_bot
         order by event.occurred_at desc limit 1
         on conflict(order_id) do update set last_observed_at=now()`,
        [visitorId,orderId,raw.project_id],
      );
    }

    if (paymentId) {
      await client.query(
        `update public.payments payment
            set approved_amount = totals.approved,
                reversed_amount = totals.reversed,
                updated_at = now()
           from (
             select
               coalesce(sum(financial_effect) filter (
                 where financial_effect > 0
               ), 0) as approved,
               abs(coalesce(sum(financial_effect) filter (
                 where financial_effect < 0
               ), 0)) as reversed
             from public.normalized_payment_events
             where payment_id = $1
           ) totals
          where payment.id = $1`,
        [paymentId],
      );
    }

    await enqueueMetaSaleEvent(client, raw, normalized, orderId, productIds);

    await client.query(
      `update public.raw_events
          set processing_status = 'normalized',
              error_code = null,
              error_message = null
        where id = $1`,
      [raw.id],
    );
    await client.query("commit");
    return "normalized";
  } catch (error) {
    await client.query("rollback");
    const blocked = error instanceof TictoNormalizationBlocked;
    const exhausted = raw.processing_attempts >= maxAttempts;
    if (!blocked && process.env.NODE_ENV !== "test") {
      const databaseError = error as {
        code?: string;
        constraint?: string;
        message?: string;
      };
      process.stderr.write(
        `${JSON.stringify({
          event: "ticto_normalization_failed",
          rawEventId: raw.id,
          code: databaseError.code ?? "unknown",
          constraint: databaseError.constraint ?? null,
          message: databaseError.message ?? "unknown",
        })}\n`,
      );
    }
    await pool.query(
      `update public.raw_events
          set processing_status = $2,
              error_code = $3,
              error_message = $4
        where id = $1`,
      [
        raw.id,
        blocked || exhausted ? "quarantined" : "failed_retryable",
        blocked
          ? error.code
          : exhausted
            ? "normalization_attempts_exhausted"
            : "normalization_failed",
        blocked ? error.message : "Falha temporária na normalização.",
      ],
    );
    return blocked || exhausted ? "quarantined" : "failed";
  } finally {
    client.release();
  }
}

export async function processTictoBatch(
  pool: pg.Pool,
  limit = 25,
  maxAttempts = 5,
) {
  const claimed = await pool.query<RawCandidate>(
    `with candidates as (
       select id
         from public.raw_events
        where source = 'ticto'
          and processing_status in ('queued', 'failed_retryable')
          and validation_status in ('valid', 'partial')
          and body_json is not null
        order by
          case when processing_status = 'queued' then 0 else 1 end,
          received_at
        for update skip locked
        limit $1
     )
     update public.raw_events raw
        set processing_status = 'processing',
            processing_attempts = processing_attempts + 1
       from candidates
      where raw.id = candidates.id
      returning
        raw.id,
        raw.organization_id,
        raw.project_id,
        raw.connection_id,
        raw.external_event_id,
        raw.idempotency_key,
        raw.received_at,
        raw.body_json,
        raw.processing_attempts`,
    [limit],
  );

  const summary = {
    claimed: claimed.rowCount ?? 0,
    normalized: 0,
    duplicate: 0,
    quarantined: 0,
    failed: 0,
  };

  for (const raw of claimed.rows) {
    const result = await processCandidate(pool, raw, maxAttempts);
    summary[result] += 1;
  }

  return summary;
}
