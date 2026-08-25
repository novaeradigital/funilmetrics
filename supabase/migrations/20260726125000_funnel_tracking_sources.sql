create table public.funnel_tracking_sources (
  organization_id uuid not null,
  project_id uuid not null,
  funnel_id uuid not null,
  tracking_source_id uuid not null references public.tracking_sources(id) on delete restrict,
  linked_by_user_id uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key(funnel_id,tracking_source_id),
  foreign key(funnel_id,organization_id,project_id)
    references public.funnels(id,organization_id,project_id) on delete restrict,
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict
);
create index funnel_tracking_sources_source_idx
  on public.funnel_tracking_sources(tracking_source_id);
alter table public.funnel_tracking_sources enable row level security;
revoke all on table public.funnel_tracking_sources from anon,authenticated;
