create table "public"."meta_creatives" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "meta_ad_account_id" uuid not null references "public"."meta_ad_accounts" ("id") on delete restrict,
  "external_id" text not null,
  "name" text,
  "thumbnail_url" text,
  "image_url" text,
  "object_story_spec" jsonb,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_id")
);

create table "public"."meta_ads" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "meta_ad_account_id" uuid not null references "public"."meta_ad_accounts" ("id") on delete restrict,
  "meta_campaign_id" uuid not null references "public"."meta_campaigns" ("id") on delete restrict,
  "meta_ad_set_id" uuid not null references "public"."meta_ad_sets" ("id") on delete restrict,
  "meta_creative_id" uuid references "public"."meta_creatives" ("id") on delete set null,
  "external_id" text not null,
  "name" text not null,
  "status" text,
  "effective_status" text,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_id")
);

create table "public"."meta_ad_insights_daily" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "meta_ad_account_id" uuid not null references "public"."meta_ad_accounts" ("id") on delete restrict,
  "meta_campaign_id" uuid references "public"."meta_campaigns" ("id") on delete restrict,
  "meta_ad_set_id" uuid references "public"."meta_ad_sets" ("id") on delete restrict,
  "meta_ad_id" uuid references "public"."meta_ads" ("id") on delete restrict,
  "external_ad_id" text not null,
  "metric_date" date not null,
  "currency" text,
  "spend" numeric(18,6) not null default 0,
  "impressions" bigint not null default 0,
  "reach" bigint not null default 0,
  "clicks" bigint not null default 0,
  "actions" jsonb,
  "action_values" jsonb,
  "raw_metric" jsonb not null,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_ad_id","metric_date")
);

create index "meta_creatives_account_idx" on "public"."meta_creatives" ("meta_ad_account_id","name");
create index "meta_ads_ad_set_idx" on "public"."meta_ads" ("meta_ad_set_id","name");
create index "meta_ad_insights_project_date_idx"
  on "public"."meta_ad_insights_daily" ("project_id","metric_date" desc);
create index "meta_ad_insights_ad_date_idx"
  on "public"."meta_ad_insights_daily" ("meta_ad_id","metric_date" desc);

alter table "public"."meta_creatives" enable row level security;
alter table "public"."meta_ads" enable row level security;
alter table "public"."meta_ad_insights_daily" enable row level security;
revoke all on table "public"."meta_creatives" from anon,authenticated;
revoke all on table "public"."meta_ads" from anon,authenticated;
revoke all on table "public"."meta_ad_insights_daily" from anon,authenticated;
