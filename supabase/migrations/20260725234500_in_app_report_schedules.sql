create type "public"."report_frequency" as enum ('daily','weekly');

create table "public"."report_schedules" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "frequency" "public"."report_frequency" not null default 'daily',
  "period_days" integer not null default 30 check ("period_days" in (7,30,90)),
  "enabled" boolean not null default true,
  "next_run_at" timestamptz not null default now(),
  "last_run_at" timestamptz,
  "created_by_user_id" uuid not null references "public"."users" ("id") on delete restrict,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete cascade,
  unique ("project_id")
);

create table "public"."report_snapshots" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "schedule_id" uuid not null references "public"."report_schedules" ("id") on delete restrict,
  "scheduled_for" timestamptz not null,
  "period_days" integer not null,
  "rule_version" text not null default 'financial_v1',
  "snapshot" jsonb not null,
  "created_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("schedule_id","scheduled_for")
);

create index "report_schedules_due_idx" on "public"."report_schedules" ("next_run_at")
  where "enabled";
create index "report_snapshots_project_idx" on "public"."report_snapshots"
  ("project_id","created_at" desc);
alter table "public"."report_schedules" enable row level security;
alter table "public"."report_snapshots" enable row level security;
revoke all on table "public"."report_schedules" from anon,authenticated;
revoke all on table "public"."report_snapshots" from anon,authenticated;
