create type public.dashboard_lifecycle_status as enum ('active','archived');
create type public.dashboard_version_status as enum ('draft','published','superseded');
create type public.dashboard_widget_type as enum
  ('kpi','time_series','bar','donut','funnel','table','comparison','note');

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null check(length(name) between 2 and 120),
  description text,
  status public.dashboard_lifecycle_status not null default 'active',
  default_period_days integer not null default 30 check(default_period_days in (7,30,90,365)),
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  archived_by_user_id uuid references public.users(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict,
  unique(id,organization_id,project_id),
  check((status='active' and archived_at is null and archived_by_user_id is null)
    or (status='archived' and archived_at is not null and archived_by_user_id is not null))
);

create table public.dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  dashboard_id uuid not null,
  version_number integer not null check(version_number > 0),
  status public.dashboard_version_status not null default 'draft',
  title text not null check(length(title) between 2 and 120),
  description text,
  global_filters jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  published_by_user_id uuid references public.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict,
  foreign key(dashboard_id,organization_id,project_id)
    references public.dashboards(id,organization_id,project_id) on delete restrict,
  unique(id,organization_id,project_id),
  unique(dashboard_id,version_number),
  check((status='published' and published_at is not null and published_by_user_id is not null)
    or status<>'published')
);
create unique index dashboard_versions_one_draft_idx
  on public.dashboard_versions(dashboard_id) where status='draft';
create index dashboard_versions_published_idx
  on public.dashboard_versions(dashboard_id,version_number desc) where status='published';

create table public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  dashboard_version_id uuid not null,
  widget_type public.dashboard_widget_type not null,
  title text not null check(length(title) between 2 and 120),
  metric_key text,
  config jsonb not null default '{}'::jsonb,
  grid_x integer not null default 0 check(grid_x between 0 and 11),
  grid_y integer not null default 0 check(grid_y >= 0),
  grid_width integer not null default 4 check(grid_width between 1 and 12),
  grid_height integer not null default 3 check(grid_height between 1 and 20),
  display_order integer not null default 0 check(display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict,
  foreign key(dashboard_version_id,organization_id,project_id)
    references public.dashboard_versions(id,organization_id,project_id) on delete cascade,
  unique(id,organization_id,project_id),
  check((widget_type='note' and metric_key is null)
    or (widget_type<>'note' and metric_key is not null))
);

create table public.dashboard_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  project_id uuid,
  name text not null check(length(name) between 2 and 120),
  description text,
  definition jsonb not null,
  is_system boolean not null default false,
  created_by_user_id uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check((is_system and organization_id is null and project_id is null)
    or (not is_system and organization_id is not null and project_id is not null))
);

create table public.dashboard_access (
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  membership_id uuid not null references public.memberships(id) on delete cascade,
  access_level text not null check(access_level in ('view','edit')),
  granted_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(dashboard_id,membership_id)
);

create index dashboards_project_status_idx
  on public.dashboards(project_id,status,updated_at desc);
create index dashboard_versions_dashboard_idx
  on public.dashboard_versions(dashboard_id,version_number desc);
create index dashboard_widgets_version_order_idx
  on public.dashboard_widgets(dashboard_version_id,display_order);

create function public.prevent_published_dashboard_version_change() returns trigger
language plpgsql as $$
begin
  if old.status='published' then raise exception 'published dashboard version is immutable'; end if;
  return new;
end $$;
create trigger dashboard_version_published_immutable
before update or delete on public.dashboard_versions
for each row execute function public.prevent_published_dashboard_version_change();

create function public.prevent_published_dashboard_widget_change() returns trigger
language plpgsql as $$
begin
  if exists(select 1 from public.dashboard_versions version
    where version.id=coalesce(old.dashboard_version_id,new.dashboard_version_id)
      and version.status='published')
  then raise exception 'published dashboard widgets are immutable'; end if;
  return coalesce(new,old);
end $$;
create trigger dashboard_widget_published_immutable
before update or delete on public.dashboard_widgets
for each row execute function public.prevent_published_dashboard_widget_change();

alter table public.dashboards enable row level security;
alter table public.dashboard_versions enable row level security;
alter table public.dashboard_widgets enable row level security;
alter table public.dashboard_templates enable row level security;
alter table public.dashboard_access enable row level security;
revoke all on table public.dashboards from anon,authenticated;
revoke all on table public.dashboard_versions from anon,authenticated;
revoke all on table public.dashboard_widgets from anon,authenticated;
revoke all on table public.dashboard_templates from anon,authenticated;
revoke all on table public.dashboard_access from anon,authenticated;
