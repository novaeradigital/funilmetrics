create type "public"."drive_sync_run_status" as enum (
  'scheduled','queued','running','completed','failed_retryable','failed_terminal'
);

create table "public"."drive_sync_schedules" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "drive_folder_id" uuid not null references "public"."drive_folders" ("id") on delete restrict,
  "enabled" boolean not null default false,
  "interval_minutes" integer not null default 60 check ("interval_minutes" between 15 and 10080),
  "next_run_at" timestamptz,
  "last_run_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("drive_folder_id"),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict
);

create table "public"."drive_change_records" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "drive_folder_id" uuid not null references "public"."drive_folders" ("id") on delete restrict,
  "drive_file_id" uuid references "public"."drive_files" ("id") on delete restrict,
  "external_file_id" text not null,
  "change_type" text not null check ("change_type" in ('new','modified','moved','removed','restored')),
  "source_modified_at" timestamptz,
  "observed_at" timestamptz not null default now(),
  "processed_at" timestamptz,
  "evidence" jsonb not null default '{}'
);

create index "drive_sync_schedules_due_idx"
  on "public"."drive_sync_schedules" ("next_run_at") where "enabled";
create index "drive_change_records_unprocessed_idx"
  on "public"."drive_change_records" ("project_id","observed_at") where "processed_at" is null;
alter table "public"."drive_sync_schedules" enable row level security;
alter table "public"."drive_change_records" enable row level security;
revoke all on table "public"."drive_sync_schedules" from anon,authenticated;
revoke all on table "public"."drive_change_records" from anon,authenticated;
