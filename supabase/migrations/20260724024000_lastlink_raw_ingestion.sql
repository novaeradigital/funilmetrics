create type "public"."connection_status"
  as enum ('active', 'inactive', 'error', 'revoked');

create type "public"."raw_event_processing_status"
  as enum (
    'received',
    'duplicate',
    'queued',
    'quarantined',
    'failed_retryable',
    'failed_terminal'
  );

create type "public"."raw_event_validation_status"
  as enum ('pending', 'valid', 'partial', 'invalid', 'unknown_event');

create table "public"."connections" (
  "id" uuid primary key default gen_random_uuid() not null,
  "public_id" uuid default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "provider" text not null,
  "name" text not null,
  "status" "public"."connection_status" default 'active' not null,
  "configuration" jsonb,
  "last_event_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "connections_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "connections_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict
);

create table "public"."webhook_endpoints" (
  "id" uuid primary key default gen_random_uuid() not null,
  "public_id" uuid default gen_random_uuid() not null,
  "connection_id" uuid not null,
  "token_hash" text not null,
  "previous_token_hash" text,
  "previous_token_valid_until" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "webhook_endpoints_connection_id_connections_id_fk"
    foreign key ("connection_id")
    references "public"."connections" ("id")
    on delete cascade
);

create table "public"."raw_events" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null,
  "source" text not null,
  "external_event_id" text,
  "external_event_name" text,
  "is_test" boolean,
  "method" text not null,
  "content_type" text not null,
  "allowed_headers" jsonb,
  "body_raw" text not null,
  "body_json" jsonb,
  "body_sha256" text not null,
  "idempotency_key" text not null,
  "idempotency_strategy" text not null,
  "created_at_raw" text,
  "received_at" timestamp with time zone default now() not null,
  "processing_status" "public"."raw_event_processing_status"
    default 'received' not null,
  "validation_status" "public"."raw_event_validation_status"
    default 'pending' not null,
  "parser_version" text not null,
  "processing_attempts" integer default 0 not null,
  "error_code" text,
  "error_message" text,
  constraint "raw_events_connection_scope_fk"
    foreign key ("connection_id", "organization_id", "project_id")
    references "public"."connections" ("id", "organization_id", "project_id")
    on delete restrict
);

create unique index "connections_public_id_uidx"
  on "public"."connections" ("public_id");
create index "connections_organization_project_idx"
  on "public"."connections" ("organization_id", "project_id");
create index "connections_provider_status_idx"
  on "public"."connections" ("provider", "status");

create unique index "webhook_endpoints_public_id_uidx"
  on "public"."webhook_endpoints" ("public_id");
create unique index "webhook_endpoints_connection_uidx"
  on "public"."webhook_endpoints" ("connection_id");

create unique index "raw_events_connection_idempotency_uidx"
  on "public"."raw_events" ("connection_id", "idempotency_key");
create unique index "raw_events_connection_external_id_uidx"
  on "public"."raw_events" ("connection_id", "external_event_id")
  where "external_event_id" is not null;
create index "raw_events_scope_received_idx"
  on "public"."raw_events" ("organization_id", "project_id", "received_at");
create index "raw_events_processing_status_idx"
  on "public"."raw_events" ("processing_status", "received_at");
create index "raw_events_external_name_idx"
  on "public"."raw_events"
  ("connection_id", "external_event_name", "received_at");

alter table "public"."connections" enable row level security;
alter table "public"."webhook_endpoints" enable row level security;
alter table "public"."raw_events" enable row level security;

create policy "connections_select_authorized"
on "public"."connections"
for select
to authenticated
using (
  "private"."can_access_project"("organization_id", "project_id")
);

revoke insert, update, delete
  on table "public"."connections" from anon, authenticated;
revoke all
  on table "public"."webhook_endpoints" from anon, authenticated;
revoke all
  on table "public"."raw_events" from anon, authenticated;

comment on table "public"."raw_events" is
  'Registro bruto imutável de webhooks; acesso somente pelo backend nesta fase.';
comment on column "public"."webhook_endpoints"."token_hash" is
  'Hash scrypt do segredo; o token em texto puro não é persistido.';
