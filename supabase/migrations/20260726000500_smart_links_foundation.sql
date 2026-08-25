create type "public"."experiment_status" as enum ('draft','active','paused','archived');
create table "public"."experiments" (
  "id" uuid primary key default gen_random_uuid(), "organization_id" uuid not null,
  "project_id" uuid not null, "name" text not null, "slug" text not null unique,
  "status" "public"."experiment_status" not null default 'draft',
  "created_by_user_id" uuid not null references "public"."users" ("id") on delete restrict,
  "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id") references "public"."projects" ("id","organization_id") on delete cascade
);
create table "public"."experiment_variants" (
  "id" uuid primary key default gen_random_uuid(), "organization_id" uuid not null,
  "project_id" uuid not null, "experiment_id" uuid not null references "public"."experiments" ("id") on delete cascade,
  "name" text not null, "destination_url" text not null check ("destination_url" ~ '^https://'),
  "weight" integer not null check ("weight">0 and "weight"<=10000),
  "position" integer not null, "created_at" timestamptz not null default now(),
  unique ("experiment_id","position")
);
create table "public"."experiment_exposures" (
  "id" uuid primary key default gen_random_uuid(), "organization_id" uuid not null,
  "project_id" uuid not null, "experiment_id" uuid not null references "public"."experiments" ("id") on delete restrict,
  "variant_id" uuid not null references "public"."experiment_variants" ("id") on delete restrict,
  "visitor_key_hash" text not null, "assignment_version" text not null default 'weighted_v1',
  "utm" jsonb, "is_bot" boolean not null default false, "exposed_at" timestamptz not null default now(),
  unique ("experiment_id","visitor_key_hash")
);
create index "experiment_exposures_experiment_idx" on "public"."experiment_exposures" ("experiment_id","exposed_at");
alter table "public"."experiments" enable row level security;
alter table "public"."experiment_variants" enable row level security;
alter table "public"."experiment_exposures" enable row level security;
revoke all on table "public"."experiments","public"."experiment_variants","public"."experiment_exposures" from anon,authenticated;
