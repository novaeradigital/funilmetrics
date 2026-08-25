create type public.campaign_action_status as enum ('pending_approval','approved','rejected','cancelled');
create table public.campaign_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  meta_campaign_id uuid not null references public.meta_campaigns(id) on delete restrict,
  action_type text not null check(action_type in ('pause','set_daily_budget')),
  snapshot jsonb not null,
  snapshot_sha256 text not null check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check(length(reason) between 5 and 1000),
  status public.campaign_action_status not null default 'pending_approval',
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  decided_by_user_id uuid references public.users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status='pending_approval' and decided_by_user_id is null and decided_at is null)
    or (status<>'pending_approval' and decided_by_user_id is not null and decided_at is not null))
);
create index campaign_action_requests_project_status_idx
  on public.campaign_action_requests(project_id,status,created_at desc);
alter table public.campaign_action_requests enable row level security;
revoke all on table public.campaign_action_requests from anon,authenticated;
create function public.prevent_campaign_action_snapshot_change() returns trigger
language plpgsql as $$ begin
  if new.snapshot is distinct from old.snapshot or new.snapshot_sha256 is distinct from old.snapshot_sha256
    or new.action_type is distinct from old.action_type or new.meta_campaign_id is distinct from old.meta_campaign_id
  then raise exception 'campaign action snapshot is immutable'; end if;
  return new;
end $$;
create trigger campaign_action_snapshot_immutable before update on public.campaign_action_requests
for each row execute function public.prevent_campaign_action_snapshot_change();
