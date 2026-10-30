import type pg from "pg";
import {
  ConfigCheckoutNormalizationBlocked,
  normalizeConfigCheckoutEvent,
} from "./configcheckout-normalizer.js";
import { calculateFinancialEffect } from "./lastlink-processor.js";

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
  pending: 1,
  in_analysis: 2,
  failed: 2,
  cancelled: 2,
  approved: 3,
  refunded: 5,
  chargeback: 5,
} as const;

const paymentRank = {
  pending: 1,
  in_analysis: 2,
  failed: 2,
  cancelled: 2,
  approved: 3,
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

function money(value: number | undefined) {
  return value === undefined ? null : value.toFixed(2);
}

async function resolvePerson(
  client: pg.PoolClient,
  raw: RawCandidate,
  normalized: ReturnType<typeof normalizeConfigCheckoutEvent>,
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
    throw new ConfigCheckoutNormalizationBlocked(
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

    const normalized = normalizeConfigCheckoutEvent({
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
    const blocked = error instanceof ConfigCheckoutNormalizationBlocked;
    const exhausted = raw.processing_attempts >= maxAttempts;
    if (!blocked && process.env.NODE_ENV !== "test") {
      const databaseError = error as {
        code?: string;
        constraint?: string;
        message?: string;
      };
      process.stderr.write(
        `${JSON.stringify({
          event: "configcheckout_normalization_failed",
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

export async function processConfigCheckoutBatch(
  pool: pg.Pool,
  limit = 25,
  maxAttempts = 5,
) {
  const claimed = await pool.query<RawCandidate>(
    `with candidates as (
       select id
         from public.raw_events
        where source = 'configcheckout'
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
