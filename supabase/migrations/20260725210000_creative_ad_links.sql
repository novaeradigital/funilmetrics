create table "public"."creative_ad_links" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "creative_id" uuid not null,
  "creative_version_id" uuid not null,
  "meta_ad_id" uuid not null references "public"."meta_ads" ("id") on delete restrict,
  "link_source" text not null default 'manual',
  "linked_by_user_id" uuid references "public"."users" ("id") on delete set null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  foreign key ("project_id","organization_id")
    references "public"."projects" ("id","organization_id") on delete restrict,
  foreign key ("creative_id","organization_id","project_id")
    references "public"."creatives" ("id","organization_id","project_id") on delete restrict,
  foreign key ("creative_version_id","organization_id","project_id")
    references "public"."creative_versions" ("id","organization_id","project_id") on delete restrict,
  unique ("project_id","meta_ad_id"),
  constraint "creative_ad_links_source_check"
    check ("link_source" in ('manual','publication','reconciliation'))
);

create index "creative_ad_links_version_idx"
  on "public"."creative_ad_links" ("creative_version_id","created_at" desc);
alter table "public"."creative_ad_links" enable row level security;
revoke all on table "public"."creative_ad_links" from anon,authenticated;
