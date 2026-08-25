create type "public"."creative_status" as enum (
  'new', 'imported', 'analyzing', 'awaiting_approval', 'approved',
  'ready_to_publish', 'published', 'paused', 'winner', 'fatigued', 'archived'
);

create type "public"."drive_source_status" as enum (
  'active', 'permission_removed', 'missing', 'removed', 'disconnected'
);

create type "public"."drive_import_job_status" as enum (
  'pending', 'inventorying', 'importing', 'completed',
  'completed_with_errors', 'failed', 'cancelled'
);

create type "public"."drive_import_item_status" as enum (
  'pending', 'downloading', 'quarantined', 'scanning', 'imported',
  'skipped_unchanged', 'rejected_format', 'rejected_size',
  'failed_retryable', 'failed_terminal'
);

create type "public"."malware_scan_status" as enum (
  'pending', 'scanning', 'clean', 'infected', 'unsupported',
  'failed_retryable', 'failed_terminal'
);

create table "public"."drive_connections" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null,
  "google_subject" text not null,
  "account_email" text,
  "granted_scopes" text[] default '{}'::text[] not null,
  "credential_secret_ref" text not null,
  "connected_at" timestamp with time zone default now() not null,
  "disconnected_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "drive_connections_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "drive_connections_scope_fk"
    foreign key ("connection_id", "organization_id", "project_id")
    references "public"."connections" ("id", "organization_id", "project_id")
    on delete restrict
);

create table "public"."drive_folders" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "drive_connection_id" uuid not null,
  "drive_folder_id" text not null,
  "name" text not null,
  "known_path" text,
  "status" "public"."drive_source_status" default 'active' not null,
  "include_subfolders" boolean default true not null,
  "authorized_by_user_id" uuid not null,
  "authorized_at" timestamp with time zone default now() not null,
  "last_inventory_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "drive_folders_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "drive_folders_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "drive_folders_connection_scope_fk"
    foreign key ("drive_connection_id", "organization_id", "project_id")
    references "public"."drive_connections" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "drive_folders_authorizer_fk"
    foreign key ("authorized_by_user_id")
    references "public"."users" ("id")
    on delete restrict
);

create table "public"."drive_files" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "drive_folder_id" uuid not null,
  "external_file_id" text not null,
  "external_parent_id" text,
  "name" text not null,
  "mime_type" text not null,
  "size_bytes" bigint,
  "modified_at_source" timestamp with time zone not null,
  "source_checksum" text,
  "status" "public"."drive_source_status" default 'active' not null,
  "first_detected_at" timestamp with time zone default now() not null,
  "last_seen_at" timestamp with time zone default now() not null,
  "removed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "drive_files_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "drive_files_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "drive_files_folder_scope_fk"
    foreign key ("drive_folder_id", "organization_id", "project_id")
    references "public"."drive_folders" ("id", "organization_id", "project_id")
    on delete restrict
);

create table "public"."creative_assets" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "content_sha256" text not null,
  "object_key" text not null,
  "storage_provider" text default 'cloudflare_r2' not null,
  "mime_type" text not null,
  "size_bytes" bigint not null,
  "malware_status" "public"."malware_scan_status" default 'pending' not null,
  "malware_engine_version" text,
  "malware_signatures_version" text,
  "scanned_at" timestamp with time zone,
  "available_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_assets_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "creative_assets_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creative_assets_clean_availability_check"
    check ("available_at" is null or "malware_status" = 'clean')
);

create table "public"."creatives" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "name" text not null,
  "status" "public"."creative_status" default 'new' not null,
  "current_version_id" uuid,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "creatives_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "creatives_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creatives_creator_fk"
    foreign key ("created_by_user_id")
    references "public"."users" ("id")
    on delete set null
);

create table "public"."creative_versions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "version_number" integer not null,
  "source_drive_file_id" uuid not null,
  "asset_id" uuid not null,
  "source_modified_at" timestamp with time zone not null,
  "content_sha256" text not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_versions_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "creative_versions_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creative_versions_creative_scope_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_versions_drive_file_scope_fk"
    foreign key ("source_drive_file_id", "organization_id", "project_id")
    references "public"."drive_files" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_versions_asset_scope_fk"
    foreign key ("asset_id", "organization_id", "project_id")
    references "public"."creative_assets" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_versions_positive_number_check"
    check ("version_number" > 0)
);

alter table "public"."creatives"
  add constraint "creatives_current_version_scope_fk"
  foreign key ("current_version_id", "organization_id", "project_id")
  references "public"."creative_versions" ("id", "organization_id", "project_id")
  on delete restrict;

create table "public"."drive_import_jobs" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "drive_folder_id" uuid not null,
  "requested_by_user_id" uuid not null,
  "idempotency_key" text not null,
  "status" "public"."drive_import_job_status" default 'pending' not null,
  "files_detected" integer default 0 not null,
  "files_imported" integer default 0 not null,
  "files_skipped" integer default 0 not null,
  "files_failed" integer default 0 not null,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "error_code" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "drive_import_jobs_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "drive_import_jobs_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "drive_import_jobs_folder_scope_fk"
    foreign key ("drive_folder_id", "organization_id", "project_id")
    references "public"."drive_folders" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "drive_import_jobs_requester_fk"
    foreign key ("requested_by_user_id")
    references "public"."users" ("id")
    on delete restrict
);

create table "public"."drive_import_items" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "job_id" uuid not null,
  "drive_file_id" uuid not null,
  "status" "public"."drive_import_item_status" default 'pending' not null,
  "attempts" integer default 0 not null,
  "asset_id" uuid,
  "creative_version_id" uuid,
  "error_code" text,
  "error_message_sanitized" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "drive_import_items_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "drive_import_items_job_scope_fk"
    foreign key ("job_id", "organization_id", "project_id")
    references "public"."drive_import_jobs" ("id", "organization_id", "project_id")
    on delete cascade,
  constraint "drive_import_items_file_scope_fk"
    foreign key ("drive_file_id", "organization_id", "project_id")
    references "public"."drive_files" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "drive_import_items_asset_scope_fk"
    foreign key ("asset_id", "organization_id", "project_id")
    references "public"."creative_assets" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "drive_import_items_version_scope_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict
);

create unique index "drive_connections_connection_uidx"
  on "public"."drive_connections" ("connection_id");
create unique index "drive_connections_subject_uidx"
  on "public"."drive_connections" ("project_id", "google_subject");
create unique index "drive_folders_external_uidx"
  on "public"."drive_folders" ("drive_connection_id", "drive_folder_id");
create unique index "drive_files_external_uidx"
  on "public"."drive_files" ("drive_folder_id", "external_file_id");
create index "drive_files_status_seen_idx"
  on "public"."drive_files" ("project_id", "status", "last_seen_at");
create unique index "creative_assets_hash_uidx"
  on "public"."creative_assets" ("organization_id", "project_id", "content_sha256");
create unique index "creative_assets_object_key_uidx"
  on "public"."creative_assets" ("object_key");
create index "creatives_scope_status_idx"
  on "public"."creatives" ("organization_id", "project_id", "status");
create unique index "creative_versions_number_uidx"
  on "public"."creative_versions" ("creative_id", "version_number");
create unique index "creative_versions_source_hash_uidx"
  on "public"."creative_versions" ("source_drive_file_id", "content_sha256");
create unique index "drive_import_jobs_idempotency_uidx"
  on "public"."drive_import_jobs" ("drive_folder_id", "idempotency_key");
create index "drive_import_jobs_status_idx"
  on "public"."drive_import_jobs" ("status", "created_at");
create unique index "drive_import_items_job_file_uidx"
  on "public"."drive_import_items" ("job_id", "drive_file_id");
create index "drive_import_items_status_idx"
  on "public"."drive_import_items" ("status", "updated_at");

alter table "public"."drive_connections" enable row level security;
alter table "public"."drive_folders" enable row level security;
alter table "public"."drive_files" enable row level security;
alter table "public"."creative_assets" enable row level security;
alter table "public"."creatives" enable row level security;
alter table "public"."creative_versions" enable row level security;
alter table "public"."drive_import_jobs" enable row level security;
alter table "public"."drive_import_items" enable row level security;

revoke all on table "public"."drive_connections" from anon, authenticated;
revoke all on table "public"."drive_folders" from anon, authenticated;
revoke all on table "public"."drive_files" from anon, authenticated;
revoke all on table "public"."creative_assets" from anon, authenticated;
revoke all on table "public"."creatives" from anon, authenticated;
revoke all on table "public"."creative_versions" from anon, authenticated;
revoke all on table "public"."drive_import_jobs" from anon, authenticated;
revoke all on table "public"."drive_import_items" from anon, authenticated;

comment on table "public"."creative_assets" is
  'Cópia interna imutável; só fica disponível após varredura limpa.';
comment on table "public"."creative_versions" is
  'Versão imutável de criativo vinculada aos bytes importados e à origem observada.';
