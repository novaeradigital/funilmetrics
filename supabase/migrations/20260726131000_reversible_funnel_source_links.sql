alter table public.funnel_tracking_sources
  add column active boolean not null default true,
  add column unlinked_at timestamptz,
  add column unlinked_by_user_id uuid references public.users(id) on delete restrict;

create index funnel_tracking_sources_active_idx
  on public.funnel_tracking_sources(project_id,funnel_id)
  where active;
