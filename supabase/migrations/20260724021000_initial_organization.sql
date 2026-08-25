create type "public"."membership_role" as enum (
  'owner',
  'administrator',
  'editor',
  'analyst',
  'viewer'
);

create type "public"."user_status" as enum (
  'invited',
  'active',
  'suspended',
  'disabled'
);

create table "public"."organizations" (
  "id" uuid primary key default gen_random_uuid() not null,
  "name" text not null,
  "slug" text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."users" (
  "id" uuid primary key default gen_random_uuid() not null,
  "auth_user_id" uuid,
  "email" text not null,
  "display_name" text,
  "status" "public"."user_status" default 'invited' not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table "public"."projects" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "name" text not null,
  "slug" text not null,
  "timezone" text default 'America/Sao_Paulo' not null,
  "currency" text default 'BRL' not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "projects_id_organization_unique"
    unique ("id", "organization_id")
);

create table "public"."memberships" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "user_id" uuid not null,
  "role" "public"."membership_role" not null,
  "invited_by_user_id" uuid,
  "joined_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "memberships_id_organization_unique"
    unique ("id", "organization_id")
);

create table "public"."project_memberships" (
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "membership_id" uuid not null,
  "role_override" "public"."membership_role",
  "created_at" timestamp with time zone default now() not null,
  constraint "project_memberships_pk"
    primary key ("project_id", "membership_id")
);

create table "public"."audit_logs" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid,
  "actor_user_id" uuid,
  "action" text not null,
  "target_type" text not null,
  "target_id" text,
  "reason" text,
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb,
  "request_id" text,
  "occurred_at" timestamp with time zone default now() not null
);

alter table "public"."projects"
  add constraint "projects_organization_id_organizations_id_fk"
  foreign key ("organization_id")
  references "public"."organizations" ("id")
  on delete restrict;

alter table "public"."memberships"
  add constraint "memberships_organization_id_organizations_id_fk"
  foreign key ("organization_id")
  references "public"."organizations" ("id")
  on delete cascade;

alter table "public"."memberships"
  add constraint "memberships_user_id_users_id_fk"
  foreign key ("user_id")
  references "public"."users" ("id")
  on delete cascade;

alter table "public"."memberships"
  add constraint "memberships_invited_by_user_id_users_id_fk"
  foreign key ("invited_by_user_id")
  references "public"."users" ("id")
  on delete set null;

alter table "public"."project_memberships"
  add constraint "project_memberships_project_org_fk"
  foreign key ("project_id", "organization_id")
  references "public"."projects" ("id", "organization_id")
  on delete cascade;

alter table "public"."project_memberships"
  add constraint "project_memberships_membership_org_fk"
  foreign key ("membership_id", "organization_id")
  references "public"."memberships" ("id", "organization_id")
  on delete cascade;

alter table "public"."audit_logs"
  add constraint "audit_logs_organization_id_organizations_id_fk"
  foreign key ("organization_id")
  references "public"."organizations" ("id")
  on delete restrict;

alter table "public"."audit_logs"
  add constraint "audit_logs_actor_user_id_users_id_fk"
  foreign key ("actor_user_id")
  references "public"."users" ("id")
  on delete set null;

alter table "public"."audit_logs"
  add constraint "audit_logs_project_org_fk"
  foreign key ("project_id", "organization_id")
  references "public"."projects" ("id", "organization_id")
  on delete restrict;

create unique index "organizations_slug_uidx"
  on "public"."organizations" ("slug");

create unique index "users_auth_user_id_uidx"
  on "public"."users" ("auth_user_id")
  where "auth_user_id" is not null;

create unique index "users_email_normalized_uidx"
  on "public"."users" (lower("email"));

create unique index "projects_organization_slug_uidx"
  on "public"."projects" ("organization_id", "slug");

create index "projects_organization_idx"
  on "public"."projects" ("organization_id");

create unique index "memberships_organization_user_uidx"
  on "public"."memberships" ("organization_id", "user_id");

create index "memberships_user_idx"
  on "public"."memberships" ("user_id");

create index "project_memberships_organization_idx"
  on "public"."project_memberships" ("organization_id");

create index "project_memberships_membership_idx"
  on "public"."project_memberships" ("membership_id");

create index "audit_logs_organization_occurred_idx"
  on "public"."audit_logs" ("organization_id", "occurred_at");

create index "audit_logs_project_occurred_idx"
  on "public"."audit_logs" ("project_id", "occurred_at");

create index "audit_logs_target_idx"
  on "public"."audit_logs" ("target_type", "target_id");
