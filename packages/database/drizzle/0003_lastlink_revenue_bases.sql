ALTER TABLE "normalized_payment_events"
  ADD COLUMN "sale_amount" numeric(18, 2),
  ADD COLUMN "sale_financial_effect" numeric(18, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN "producer_commission_amount" numeric(18, 2),
  ADD COLUMN "producer_commission_financial_effect" numeric(18, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN "commission_data_status" text DEFAULT 'missing' NOT NULL;

UPDATE "normalized_payment_events" AS event
SET
  "sale_amount" = event."amount",
  "sale_financial_effect" = event."financial_effect",
  "producer_commission_amount" = commission.amount,
  "producer_commission_financial_effect" = CASE
    WHEN event."financial_effect" > 0 THEN commission.amount
    WHEN event."financial_effect" < 0 THEN -commission.amount
    ELSE 0
  END,
  "commission_data_status" = CASE
    WHEN commission.amount IS NULL THEN 'missing'
    ELSE 'complete'
  END
FROM (
  SELECT raw.id AS raw_event_id,
         sum((entry->>'Value')::numeric) FILTER (
           WHERE upper(entry->>'Source') = 'PRODUCER'
             AND jsonb_typeof(entry->'Value') = 'number'
         ) AS amount
  FROM "raw_events" AS raw
  LEFT JOIN LATERAL jsonb_array_elements(
    coalesce(raw.body_json->'Data'->'Commissions', '[]'::jsonb)
  ) AS entry ON true
  GROUP BY raw.id
) AS commission
WHERE commission.raw_event_id = event.raw_event_id;

CREATE INDEX "normalized_payment_events_commission_status_idx"
  ON "normalized_payment_events" ("project_id", "commission_data_status", "occurred_at");
