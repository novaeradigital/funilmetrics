create table "public"."meta_ad_accounts" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null references "public"."connections" ("id") on delete restrict,
  "external_id" text not null,
  "name" text not null,
  "account_status" integer,
  "currency" text,
  "timezone_name" text,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_id")
);

create table "public"."meta_campaigns" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "meta_ad_account_id" uuid not null references "public"."meta_ad_accounts" ("id") on delete restrict,
  "external_id" text not null,
  "name" text not null,
  "status" text,
  "effective_status" text,
  "objective" text,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_id")
);

create table "public"."meta_ad_sets" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "meta_ad_account_id" uuid not null references "public"."meta_ad_accounts" ("id") on delete restrict,
  "meta_campaign_id" uuid not null references "public"."meta_campaigns" ("id") on delete restrict,
  "external_id" text not null,
  "name" text not null,
  "status" text,
  "effective_status" text,
  "daily_budget_minor" bigint,
  "lifetime_budget_minor" bigint,
  "optimization_goal" text,
  "last_synced_at" timestamptz not null default now(),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("project_id","external_id")
);

create index "meta_ad_accounts_project_idx" on "public"."meta_ad_accounts" ("project_id","name");
create index "meta_campaigns_account_idx" on "public"."meta_campaigns" ("meta_ad_account_id","name");
create index "meta_ad_sets_campaign_idx" on "public"."meta_ad_sets" ("meta_campaign_id","name");

alter table "public"."meta_ad_accounts" enable row level security;
alter table "public"."meta_campaigns" enable row level security;
alter table "public"."meta_ad_sets" enable row level security;
revoke all on table "public"."meta_ad_accounts" from anon,authenticated;
revoke all on table "public"."meta_campaigns" from anon,authenticated;
revoke all on table "public"."meta_ad_sets" from anon,authenticated;
