create table public.meta_manager_views (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  level text not null check (level in ('accounts','campaigns','adsets','ads')),
  columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,user_id,level),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);

create table public.meta_manager_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  entity_type text not null check (entity_type in ('campaign','adset','ad')),
  entity_id uuid not null,
  external_id text not null,
  action_type text not null check (action_type in ('activate','pause')),
  before_state jsonb not null,
  desired_state jsonb not null,
  reason text not null check (length(reason) between 5 and 1000),
  idempotency_key text not null,
  status public.campaign_action_status not null default 'pending_approval',
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  decided_by_user_id uuid references public.users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  unique(project_id,idempotency_key),
  check ((status='pending_approval' and decided_by_user_id is null and decided_at is null)
    or (status<>'pending_approval' and decided_by_user_id is not null and decided_at is not null))
);

create index meta_manager_actions_project_status_idx
  on public.meta_manager_action_requests(project_id,status,created_at desc);
alter table public.meta_manager_views enable row level security;
alter table public.meta_manager_action_requests enable row level security;
revoke all on table public.meta_manager_views from anon,authenticated;
revoke all on table public.meta_manager_action_requests from anon,authenticated;

create function public.prevent_meta_manager_request_change() returns trigger
language plpgsql as $$ begin
  if new.entity_type is distinct from old.entity_type
    or new.entity_id is distinct from old.entity_id
    or new.external_id is distinct from old.external_id
    or new.action_type is distinct from old.action_type
    or new.before_state is distinct from old.before_state
    or new.desired_state is distinct from old.desired_state
    or new.reason is distinct from old.reason
    or new.idempotency_key is distinct from old.idempotency_key
  then raise exception 'meta manager action request is immutable'; end if;
  return new;
end $$;
create trigger meta_manager_request_immutable before update on public.meta_manager_action_requests
for each row execute function public.prevent_meta_manager_request_change();
