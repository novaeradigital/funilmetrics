create type "public"."creative_ai_job_kind" as enum (
  'transcription', 'text_extraction', 'analysis'
);
create type "public"."creative_ai_job_status" as enum (
  'pending', 'processing', 'completed', 'failed_retryable',
  'failed_terminal', 'cancelled'
);

create table "public"."creative_ai_jobs" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "kind" "public"."creative_ai_job_kind" not null,
  "status" "public"."creative_ai_job_status" default 'pending' not null,
  "idempotency_key" text not null,
  "model" text not null,
  "prompt_version" text,
  "requested_by_user_id" uuid not null,
  "attempts" integer default 0 not null,
  "error_code" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "creative_ai_jobs_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id") on delete restrict,
  constraint "creative_ai_jobs_creative_scope_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_ai_jobs_version_scope_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_ai_jobs_requester_fk"
    foreign key ("requested_by_user_id") references "public"."users" ("id")
    on delete restrict
);
create unique index "creative_ai_jobs_idempotency_uidx"
  on "public"."creative_ai_jobs" ("creative_version_id", "kind", "idempotency_key");
create index "creative_ai_jobs_status_idx"
  on "public"."creative_ai_jobs" ("status", "created_at");

create table "public"."creative_transcripts" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "job_id" uuid not null,
  "model" text not null,
  "language" text,
  "text" text not null,
  "segments" jsonb,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_transcripts_job_unique" unique ("job_id"),
  constraint "creative_transcripts_version_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_transcripts_creative_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_transcripts_job_fk"
    foreign key ("job_id") references "public"."creative_ai_jobs" ("id")
    on delete restrict
);

create table "public"."creative_text_extractions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "job_id" uuid not null,
  "method" text not null,
  "model" text,
  "text" text not null,
  "evidence" jsonb,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_text_extractions_job_unique" unique ("job_id"),
  constraint "creative_text_extractions_version_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_text_extractions_creative_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_text_extractions_job_fk"
    foreign key ("job_id") references "public"."creative_ai_jobs" ("id")
    on delete restrict
);

create table "public"."creative_analyses" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "job_id" uuid not null,
  "model" text not null,
  "prompt_version" text not null,
  "hook" text,
  "promise" text,
  "mechanism" text,
  "proof" jsonb,
  "objections" jsonb,
  "cta" text,
  "structure" jsonb,
  "performance_hypotheses" jsonb,
  "evidence" jsonb not null,
  "confidence" numeric(5,4) not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_analyses_job_unique" unique ("job_id"),
  constraint "creative_analyses_confidence_check"
    check ("confidence" between 0 and 1),
  constraint "creative_analyses_version_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_analyses_creative_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_analyses_job_fk"
    foreign key ("job_id") references "public"."creative_ai_jobs" ("id")
    on delete restrict
);

alter table "public"."creative_ai_jobs" enable row level security;
alter table "public"."creative_transcripts" enable row level security;
alter table "public"."creative_text_extractions" enable row level security;
alter table "public"."creative_analyses" enable row level security;
revoke all on table "public"."creative_ai_jobs" from anon, authenticated;
revoke all on table "public"."creative_transcripts" from anon, authenticated;
revoke all on table "public"."creative_text_extractions" from anon, authenticated;
revoke all on table "public"."creative_analyses" from anon, authenticated;
