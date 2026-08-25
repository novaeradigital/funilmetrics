alter table "public"."creative_publication_requests"
  add column "meta_connection_id" uuid;

alter table "public"."creative_publication_requests"
  add constraint "creative_publication_requests_meta_connection_fk"
  foreign key ("meta_connection_id") references "public"."connections" ("id")
  on delete restrict;

create index "creative_publication_requests_meta_connection_idx"
  on "public"."creative_publication_requests" ("meta_connection_id","status");
