create type "public"."meta_authorization_mode" as enum ('oauth_user','system_user');

create table "public"."meta_authorizations" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid not null references "public"."connections" ("id") on delete restrict,
  "mode" "public"."meta_authorization_mode" not null,
  "external_business_id" text,
  "external_subject_id" text,
  "external_subject_name" text,
  "granted_scopes" text[] not null default '{}',
  "token_expires_at" timestamptz,
  "status" text not null default 'pending',
  "last_validated_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  unique ("connection_id")
);

create table "public"."meta_oauth_states" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "requested_by_user_id" uuid not null references "public"."users" ("id") on delete restrict,
  "state_hash" text not null unique,
  "code_verifier_ciphertext" bytea,
  "expires_at" timestamptz not null,
  "consumed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict
);

create index "meta_authorizations_project_mode_idx"
  on "public"."meta_authorizations" ("project_id","mode","status");
create index "meta_oauth_states_expiry_idx"
  on "public"."meta_oauth_states" ("expires_at") where "consumed_at" is null;

alter table "public"."meta_authorizations" enable row level security;
alter table "public"."meta_oauth_states" enable row level security;
revoke all on table "public"."meta_authorizations" from anon,authenticated;
revoke all on table "public"."meta_oauth_states" from anon,authenticated;
