create table "public"."ai_usage_records" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "job_id" uuid not null references "public"."creative_ai_jobs" ("id") on delete restrict,
  "provider" text not null default 'openai',
  "model" text not null,
  "operation" text not null,
  "input_tokens" bigint,
  "output_tokens" bigint,
  "total_tokens" bigint,
  "audio_seconds" numeric(18,3),
  "estimated_cost_brl" numeric(18,6),
  "pricing_version" text,
  "measured_at" timestamptz not null default now(),
  unique ("job_id","operation"),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict
);
create index "ai_usage_records_project_month_idx"
  on "public"."ai_usage_records" ("project_id","measured_at");
alter table "public"."ai_usage_records" enable row level security;
revoke all on table "public"."ai_usage_records" from anon,authenticated;
