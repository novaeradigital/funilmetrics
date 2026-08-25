create table "public"."meta_sync_schedules" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null,
  "enabled" boolean not null default false,
  "interval_minutes" integer not null default 360
    check ("interval_minutes" between 60 and 10080),
  "next_run_at" timestamptz,
  "last_run_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("connection_id"),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  foreign key ("connection_id","organization_id","project_id")
    references "public"."connections" ("id","organization_id","project_id")
    on delete restrict
);

create table "public"."meta_sync_runs" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null,
  "schedule_id" uuid references "public"."meta_sync_schedules" ("id")
    on delete restrict,
  "idempotency_key" text not null,
  "status" text not null default 'queued'
    check ("status" in (
      'queued','running','completed','failed_retryable','failed_terminal'
    )),
  "attempts" integer not null default 0,
  "scheduled_for" timestamptz,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "account_count" integer not null default 0,
  "campaign_count" integer not null default 0,
  "ad_set_count" integer not null default 0,
  "ad_count" integer not null default 0,
  "creative_count" integer not null default 0,
  "insight_count" integer not null default 0,
  "error_code" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("connection_id","idempotency_key"),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  foreign key ("connection_id","organization_id","project_id")
    references "public"."connections" ("id","organization_id","project_id")
    on delete restrict
);

create index "meta_sync_schedules_due_idx"
  on "public"."meta_sync_schedules" ("next_run_at") where "enabled";
create index "meta_sync_runs_queue_idx"
  on "public"."meta_sync_runs" ("status","created_at");
create index "meta_sync_runs_connection_idx"
  on "public"."meta_sync_runs" ("connection_id","created_at" desc);

alter table "public"."meta_sync_schedules" enable row level security;
alter table "public"."meta_sync_runs" enable row level security;
revoke all on table "public"."meta_sync_schedules" from anon,authenticated;
revoke all on table "public"."meta_sync_runs" from anon,authenticated;
