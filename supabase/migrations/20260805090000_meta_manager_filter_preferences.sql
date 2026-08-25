alter table public.meta_manager_views
  add column if not exists filters jsonb not null default '{}'::jsonb;

alter table public.meta_manager_views
  drop constraint if exists meta_manager_views_filters_object;

alter table public.meta_manager_views
  add constraint meta_manager_views_filters_object
  check (jsonb_typeof(filters) = 'object');
