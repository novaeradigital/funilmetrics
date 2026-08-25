create table "public"."ai_pricing_versions" (
  "id" uuid primary key default gen_random_uuid(),
  "provider" text not null,
  "model" text not null,
  "operation" text not null,
  "currency" text not null default 'USD',
  "input_cost_per_million" numeric(18,8),
  "output_cost_per_million" numeric(18,8),
  "audio_cost_per_minute" numeric(18,8),
  "valid_from" timestamptz not null,
  "valid_until" timestamptz,
  "source_reference" text,
  "created_at" timestamptz not null default now(),
  unique ("provider","model","operation","valid_from")
);

alter table "public"."ai_pricing_versions" enable row level security;
revoke all on table "public"."ai_pricing_versions" from anon,authenticated;

create index "ai_pricing_versions_lookup_idx"
  on "public"."ai_pricing_versions" ("provider","model","operation","valid_from" desc);
