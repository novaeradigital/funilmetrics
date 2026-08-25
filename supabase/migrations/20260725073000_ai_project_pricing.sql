create table "public"."ai_project_pricing_versions" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "model" text not null,
  "operation" text not null,
  "input_cost_per_million_brl" numeric(18,8),
  "output_cost_per_million_brl" numeric(18,8),
  "audio_cost_per_minute_brl" numeric(18,8),
  "source_reference" text,
  "valid_from" timestamptz not null default now(),
  "valid_until" timestamptz,
  "created_by_user_id" uuid,
  "created_at" timestamptz not null default now(),
  constraint "ai_project_pricing_project_org_fk"
    foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  constraint "ai_project_pricing_creator_fk"
    foreign key ("created_by_user_id")
    references "public"."users" ("id") on delete set null,
  constraint "ai_project_pricing_operation_check"
    check ("operation" in ('creative_analysis','creative_transcription')),
  constraint "ai_project_pricing_values_check"
    check (
      coalesce("input_cost_per_million_brl",0) >= 0 and
      coalesce("output_cost_per_million_brl",0) >= 0 and
      coalesce("audio_cost_per_minute_brl",0) >= 0
    )
);

create unique index "ai_project_pricing_active_uidx"
  on "public"."ai_project_pricing_versions" ("project_id","model","operation")
  where "valid_until" is null;
create index "ai_project_pricing_history_idx"
  on "public"."ai_project_pricing_versions"
  ("project_id","operation","valid_from" desc);

alter table "public"."ai_project_pricing_versions" enable row level security;
revoke all on table "public"."ai_project_pricing_versions" from anon,authenticated;

comment on table "public"."ai_project_pricing_versions" is
  'Preços em BRL informados por projeto, preservados temporalmente e usados apenas para estimar custo medido de IA.';
