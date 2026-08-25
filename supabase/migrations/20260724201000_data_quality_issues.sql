create table "public"."data_quality_issues" (
  "id" uuid primary key default gen_random_uuid() not null,
  "organization_id" uuid not null,
  "project_id" uuid not null,
  "connection_id" uuid,
  "issue_key" text not null,
  "issue_type" text not null,
  "severity" text not null,
  "status" text default 'open' not null,
  "title" text not null,
  "evidence" jsonb not null,
  "rule_version" text not null,
  "occurrences" integer default 1 not null,
  "first_detected_at" timestamp with time zone default now() not null,
  "last_detected_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  constraint "data_quality_issues_project_org_fk"
    foreign key ("project_id", "organization_id")
    references "public"."projects" ("id", "organization_id")
    on delete restrict,
  constraint "data_quality_issues_connection_scope_fk"
    foreign key ("connection_id", "organization_id", "project_id")
    references "public"."connections" ("id", "organization_id", "project_id")
    on delete restrict,
  constraint "data_quality_issues_severity_check"
    check ("severity" in ('critical', 'warning', 'info')),
  constraint "data_quality_issues_status_check"
    check ("status" in ('open', 'resolved'))
);

create unique index "data_quality_issues_open_key_uidx"
  on "public"."data_quality_issues" ("project_id", "issue_key")
  where "status" = 'open';
create index "data_quality_issues_scope_status_idx"
  on "public"."data_quality_issues"
  ("organization_id", "project_id", "status", "last_detected_at");
create index "data_quality_issues_connection_idx"
  on "public"."data_quality_issues" ("connection_id", "status");

alter table "public"."data_quality_issues" enable row level security;
revoke all on table "public"."data_quality_issues" from anon, authenticated;

comment on table "public"."data_quality_issues" is
  'Ocorrências de qualidade abertas e resolvidas pelo monitor idempotente.';
