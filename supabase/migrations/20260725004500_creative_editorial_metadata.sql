create type "public"."creative_tag_source" as enum ('manual', 'ai');

create table "public"."creative_editorial_metadata" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "copy_text" text,
  "headline" text,
  "cta" text,
  "destination_url" text,
  "notes" text,
  "updated_by_user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "creative_editorial_metadata_scope_unique"
    unique ("creative_id", "creative_version_id"),
  constraint "creative_editorial_metadata_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creative_editorial_metadata_creative_scope_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_editorial_metadata_version_scope_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_editorial_metadata_updater_fk"
    foreign key ("updated_by_user_id")
    references "public"."users" ("id")
    on delete restrict,
  constraint "creative_editorial_destination_url_check"
    check (
      "destination_url" is null
      or "destination_url" ~* '^https://'
    )
);

create table "public"."creative_tags" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "name" text not null,
  "normalized_name" text not null,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  constraint "creative_tags_id_scope_unique"
    unique ("id", "organization_id", "project_id"),
  constraint "creative_tags_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creative_tags_creator_fk"
    foreign key ("created_by_user_id")
    references "public"."users" ("id")
    on delete set null,
  constraint "creative_tags_normalized_name_check"
    check (length("normalized_name") between 1 and 80)
);

create unique index "creative_tags_scope_name_uidx"
  on "public"."creative_tags" (
    "organization_id", "project_id", "normalized_name"
  );

create table "public"."creative_tag_assignments" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "tag_id" uuid not null,
  "source" "public"."creative_tag_source" default 'manual' not null,
  "confidence" numeric(5, 4),
  "assigned_by_user_id" uuid,
  "assigned_at" timestamp with time zone default now() not null,
  "removed_at" timestamp with time zone,
  constraint "creative_tag_assignments_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "creative_tag_assignments_creative_scope_fk"
    foreign key ("creative_id", "organization_id", "project_id")
    references "public"."creatives" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_tag_assignments_version_scope_fk"
    foreign key ("creative_version_id", "organization_id", "project_id")
    references "public"."creative_versions" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_tag_assignments_tag_scope_fk"
    foreign key ("tag_id", "organization_id", "project_id")
    references "public"."creative_tags" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "creative_tag_assignments_assigner_fk"
    foreign key ("assigned_by_user_id")
    references "public"."users" ("id")
    on delete set null,
  constraint "creative_tag_assignments_confidence_check"
    check (
      ("source" = 'manual' and "confidence" is null)
      or ("source" = 'ai' and "confidence" between 0 and 1)
    )
);

create unique index "creative_tag_assignments_active_uidx"
  on "public"."creative_tag_assignments" (
    "creative_version_id", "tag_id", "source"
  )
  where "removed_at" is null;

create index "creative_tag_assignments_creative_idx"
  on "public"."creative_tag_assignments" (
    "creative_id", "creative_version_id", "source"
  );

alter table "public"."creative_editorial_metadata" enable row level security;
alter table "public"."creative_tags" enable row level security;
alter table "public"."creative_tag_assignments" enable row level security;

revoke all on table "public"."creative_editorial_metadata" from anon, authenticated;
revoke all on table "public"."creative_tags" from anon, authenticated;
revoke all on table "public"."creative_tag_assignments" from anon, authenticated;

comment on table "public"."creative_editorial_metadata" is
  'Rascunho editorial auditável ligado à versão exata do criativo.';
comment on table "public"."creative_tag_assignments" is
  'Tags manuais ou de IA; remoções são preservadas por removed_at.';
