create type public.funnel_operation_type as enum ('perpetual','launch','hybrid');
create type public.funnel_status as enum ('draft','active','archived');
create table public.funnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null check(length(name) between 1 and 160),
  operation_type public.funnel_operation_type not null,
  status public.funnel_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id,project_id),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  check(ends_at is null or starts_at is not null),
  check(ends_at is null or ends_at>starts_at),
  check(operation_type<>'launch' or (starts_at is not null and ends_at is not null))
);
create table public.funnel_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  funnel_id uuid not null,
  position integer not null check(position between 1 and 100),
  name text not null check(length(name) between 1 and 120),
  event_key text not null check(event_key in
   ('page_view','video_play','video_progress_50','video_complete','cta_click',
    'form_submit','checkout_abandoned','payment_pending','payment_approved',
    'payment_refunded','payment_chargeback')),
  created_at timestamptz not null default now(),
  unique(funnel_id,position),
  foreign key(funnel_id,organization_id,project_id)
    references public.funnels(id,organization_id,project_id) on delete restrict
);
create index funnels_project_status_idx on public.funnels(project_id,status,created_at desc);
alter table public.funnels enable row level security;
alter table public.funnel_steps enable row level security;
revoke all on table public.funnels from anon,authenticated;
revoke all on table public.funnel_steps from anon,authenticated;
