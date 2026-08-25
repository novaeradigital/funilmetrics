create type "public"."meta_publication_execution_status" as enum (
  'simulation_pending','simulation_completed','ready_for_manual_release',
  'release_requested','processing','succeeded','failed_retryable',
  'failed_terminal','cancelled','reconciliation_required'
);

create table "public"."meta_publication_executions" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "publication_request_id" uuid not null references "public"."creative_publication_requests" ("id") on delete restrict,
  "publication_approval_id" uuid not null references "public"."creative_publication_approvals" ("id") on delete restrict,
  "idempotency_key" text not null,
  "mode" text not null default 'simulation',
  "status" "public"."meta_publication_execution_status" not null default 'simulation_pending',
  "attempts" integer not null default 0,
  "request_fingerprint" text not null,
  "external_media_id" text,
  "external_creative_id" text,
  "external_ad_id" text,
  "last_error_code" text,
  "last_error_sanitized" text,
  "requested_by_user_id" uuid not null references "public"."users" ("id") on delete restrict,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("idempotency_key"),
  unique ("publication_request_id","publication_approval_id")
);

create index "meta_publication_executions_status_idx"
  on "public"."meta_publication_executions" ("status","created_at");
alter table "public"."meta_publication_executions" enable row level security;
revoke all on table "public"."meta_publication_executions" from anon,authenticated;
