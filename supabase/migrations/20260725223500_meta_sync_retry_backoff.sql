alter table "public"."meta_sync_runs"
  add column "next_attempt_at" timestamptz not null default now();

drop index "public"."meta_sync_runs_queue_idx";
create index "meta_sync_runs_queue_idx"
  on "public"."meta_sync_runs" ("next_attempt_at","created_at")
  where "status" in ('queued','failed_retryable');
