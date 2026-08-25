create table "public"."integration_secrets" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "provider" text not null,
  "kind" text not null,
  "ciphertext" bytea not null,
  "initialization_vector" bytea not null,
  "authentication_tag" bytea not null,
  "key_version" integer default 1 not null,
  "created_at" timestamp with time zone default now() not null,
  "rotated_at" timestamp with time zone,
  constraint "integration_secrets_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "integration_secrets_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "integration_secrets_provider_check"
    check ("provider" in ('google_drive')),
  constraint "integration_secrets_kind_check"
    check ("kind" in ('oauth_refresh_token'))
);

alter table "public"."drive_connections"
  alter column "credential_secret_ref" type uuid
  using "credential_secret_ref"::uuid;

alter table "public"."drive_connections"
  add constraint "drive_connections_secret_scope_fk"
  foreign key ("credential_secret_ref", "organization_id", "project_id")
  references "public"."integration_secrets" ("id", "organization_id", "project_id")
  on delete restrict;

create index "integration_secrets_scope_provider_idx"
  on "public"."integration_secrets" ("organization_id", "project_id", "provider");

alter table "public"."integration_secrets" enable row level security;
revoke all on table "public"."integration_secrets" from anon, authenticated;

comment on table "public"."integration_secrets" is
  'Segredos externos criptografados no aplicativo; acesso exclusivo do backend.';
