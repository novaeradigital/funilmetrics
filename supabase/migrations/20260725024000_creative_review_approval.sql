create type "public"."creative_approval_decision" as enum (
  'approved', 'rejected', 'revoked'
);

create table "public"."creative_status_history" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "from_status" "public"."creative_status" not null,
  "to_status" "public"."creative_status" not null,
  "changed_by_user_id" uuid not null,
  "reason" text,
  "occurred_at" timestamp with time zone default now() not null,
  foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  foreign key ("changed_by_user_id") references "public"."users" ("id")
    on delete restrict
);

create table "public"."creative_approvals" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "decision" "public"."creative_approval_decision" not null,
  "decided_by_user_id" uuid not null,
  "reason" text,
  "decided_at" timestamp with time zone default now() not null,
  foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  foreign key ("decided_by_user_id") references "public"."users" ("id")
    on delete restrict
);

create index "creative_status_history_creative_idx"
  on "public"."creative_status_history" ("creative_id", "occurred_at" desc);
create index "creative_approvals_version_idx"
  on "public"."creative_approvals" ("creative_version_id", "decided_at" desc);

alter table "public"."creative_status_history" enable row level security;
alter table "public"."creative_approvals" enable row level security;
revoke all on table "public"."creative_status_history" from anon, authenticated;
revoke all on table "public"."creative_approvals" from anon, authenticated;
