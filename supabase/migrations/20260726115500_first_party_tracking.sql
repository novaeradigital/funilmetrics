create table public.tracking_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  name text not null check(length(name) between 1 and 120),
  public_key uuid not null default gen_random_uuid() unique,
  allowed_origins text[] not null default '{}',
  active boolean not null default true,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  tracking_source_id uuid not null references public.tracking_sources(id) on delete restrict,
  external_event_id text not null check(length(external_event_id) between 8 and 120),
  event_type text not null check(event_type in
    ('page_view','video_play','video_progress_25','video_progress_50',
     'video_progress_75','video_complete','cta_click','form_submit')),
  visitor_id text check(visitor_id is null or length(visitor_id) between 8 and 120),
  session_id text check(session_id is null or length(session_id) between 8 and 120),
  occurred_at timestamptz not null,
  page_url text not null check(length(page_url) between 1 and 2048),
  referrer text check(referrer is null or length(referrer)<=2048),
  utm jsonb not null default '{}'::jsonb,
  properties jsonb not null default '{}'::jsonb,
  is_bot boolean not null default false,
  received_at timestamptz not null default now(),
  unique(tracking_source_id,external_event_id),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index tracking_events_project_occurred_idx
  on public.tracking_events(project_id,occurred_at desc);
create index tracking_events_source_type_idx
  on public.tracking_events(tracking_source_id,event_type,occurred_at desc);
alter table public.tracking_sources enable row level security;
alter table public.tracking_events enable row level security;
revoke all on table public.tracking_sources from anon,authenticated;
revoke all on table public.tracking_events from anon,authenticated;
