alter table "public"."experiment_exposures"
  add column "tracking_token" text;

create unique index "experiment_exposures_tracking_token_uidx"
  on "public"."experiment_exposures" ("tracking_token")
  where "tracking_token" is not null;

create table "public"."experiment_conversions" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "experiment_id" uuid not null references "public"."experiments" ("id") on delete restrict,
  "variant_id" uuid not null references "public"."experiment_variants" ("id") on delete restrict,
  "exposure_id" uuid not null references "public"."experiment_exposures" ("id") on delete restrict,
  "order_id" uuid not null references "public"."commerce_orders" ("id") on delete restrict,
  "first_observed_at" timestamptz not null default now(),
  "last_observed_at" timestamptz not null default now(),
  unique ("order_id"),
  unique ("exposure_id","order_id")
);

create index "experiment_conversions_experiment_idx"
  on "public"."experiment_conversions" ("experiment_id","first_observed_at");
alter table "public"."experiment_conversions" enable row level security;
revoke all on table "public"."experiment_conversions" from anon,authenticated;
