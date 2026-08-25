create type "public"."creative_publication_status" as enum (
  'draft','preview_ready','action_approved','publishing',
  'published','failed','cancelled'
);

create table "public"."creative_publication_requests" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "creative_approval_id" uuid not null,
  "ad_account_external_id" text not null,
  "campaign_external_id" text not null,
  "ad_set_external_id" text not null,
  "destination_url" text not null,
  "daily_budget" numeric(18,2) not null,
  "currency" text default 'BRL' not null,
  "status" "public"."creative_publication_status" default 'draft' not null,
  "requested_by_user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  check ("destination_url" ~ '^https://'),
  check ("daily_budget" > 0),
  foreign key ("creative_id","organization_id","project_id")
    references "public"."creatives" ("id","organization_id","project_id")
    on delete restrict,
  foreign key ("creative_version_id","organization_id","project_id")
    references "public"."creative_versions" ("id","organization_id","project_id")
    on delete restrict,
  foreign key ("creative_approval_id")
    references "public"."creative_approvals" ("id") on delete restrict,
  foreign key ("requested_by_user_id") references "public"."users" ("id")
    on delete restrict
);

create table "public"."creative_publication_previews" (
  "id" uuid primary key default gen_random_uuid() not null,
  "publication_request_id" uuid not null,
  "snapshot" jsonb not null,
  "snapshot_sha256" text not null,
  "generated_by_user_id" uuid not null,
  "generated_at" timestamp with time zone default now() not null,
  unique ("publication_request_id","snapshot_sha256"),
  foreign key ("publication_request_id")
    references "public"."creative_publication_requests" ("id") on delete restrict,
  foreign key ("generated_by_user_id") references "public"."users" ("id")
    on delete restrict
);

create table "public"."creative_publication_approvals" (
  "id" uuid primary key default gen_random_uuid() not null,
  "publication_request_id" uuid not null,
  "publication_preview_id" uuid not null,
  "snapshot_sha256" text not null,
  "approved_by_user_id" uuid not null,
  "approved_at" timestamp with time zone default now() not null,
  "revoked_at" timestamp with time zone,
  foreign key ("publication_request_id")
    references "public"."creative_publication_requests" ("id") on delete restrict,
  foreign key ("publication_preview_id")
    references "public"."creative_publication_previews" ("id") on delete restrict,
  foreign key ("approved_by_user_id") references "public"."users" ("id")
    on delete restrict
);

create unique index "creative_publication_active_approval_uidx"
  on "public"."creative_publication_approvals" ("publication_request_id")
  where "revoked_at" is null;
create index "creative_publication_requests_project_status_idx"
  on "public"."creative_publication_requests" ("project_id","status","created_at");

alter table "public"."creative_publication_requests" enable row level security;
alter table "public"."creative_publication_previews" enable row level security;
alter table "public"."creative_publication_approvals" enable row level security;
revoke all on table "public"."creative_publication_requests" from anon,authenticated;
revoke all on table "public"."creative_publication_previews" from anon,authenticated;
revoke all on table "public"."creative_publication_approvals" from anon,authenticated;
