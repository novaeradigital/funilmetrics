create type "public"."product_journey_role" as enum (
  'primary','order_bump','upsell','downsell','subscription','addon','unknown'
);

create table "public"."product_classifications" (
  "id" uuid primary key default gen_random_uuid(),
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "product_id" uuid not null,
  "role" "public"."product_journey_role" not null,
  "parent_product_id" uuid,
  "source" text not null default 'manual',
  "confidence" numeric(5,4),
  "reason" text,
  "effective_from" timestamptz not null default now(),
  "effective_until" timestamptz,
  "classified_by_user_id" uuid references "public"."users" ("id") on delete restrict,
  "created_at" timestamptz not null default now(),
  foreign key ("product_id","organization_id","project_id")
    references "public"."commerce_products" ("id","organization_id","project_id") on delete restrict,
  foreign key ("parent_product_id","organization_id","project_id")
    references "public"."commerce_products" ("id","organization_id","project_id") on delete restrict,
  check ("parent_product_id" is null or "parent_product_id"<>"product_id")
);

create unique index "product_classifications_current_uidx"
  on "public"."product_classifications" ("product_id")
  where "effective_until" is null;
create index "product_classifications_parent_idx"
  on "public"."product_classifications" ("project_id","parent_product_id","role");
alter table "public"."product_classifications" enable row level security;
revoke all on table "public"."product_classifications" from anon,authenticated;
