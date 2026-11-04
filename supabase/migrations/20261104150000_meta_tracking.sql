-- Rastreamento Meta (porte do ConfigCheckout): ficha do visitante, pixel por
-- projeto de negocio, fila de eventos para a Graph API e gatilho do
-- InitiateCheckout configuravel por fonte.

alter table public.tracking_events
  drop constraint tracking_events_event_type_check;
alter table public.tracking_events
  add constraint tracking_events_event_type_check check (event_type in
    ('page_view','video_play','video_progress_25','video_progress_50',
     'video_progress_75','video_complete','cta_click','form_submit',
     'view_content','initiate_checkout'));

alter table public.tracking_sources
  add column business_project_id uuid
    references public.business_projects(id) on delete set null,
  add column ic_trigger_type text not null default 'attribute'
    check (ic_trigger_type in ('attribute','selector','id','url')),
  add column ic_trigger_value text,
  add column product_page boolean not null default false;

create table public.tracking_visitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  tracking_source_id uuid not null
    references public.tracking_sources(id) on delete cascade,
  visitor_id text not null check (length(visitor_id) between 8 and 120),
  fbp text,
  fbc text,
  fbclid text,
  client_ip text,
  user_agent text,
  first_url text,
  first_referrer text,
  utm jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (tracking_source_id, visitor_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete restrict
);
create index tracking_visitors_project_idx
  on public.tracking_visitors (project_id, last_seen_at desc);
alter table public.tracking_visitors enable row level security;
revoke all on table public.tracking_visitors from anon, authenticated;

create table public.business_meta_pixels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  business_project_id uuid not null unique
    references public.business_projects(id) on delete cascade,
  pixel_id text not null check (length(pixel_id) between 5 and 32),
  active boolean not null default true,
  mode text not null default 'api' check (mode in ('api','browser','both','off')),
  test_event_code text,
  event_id_prefix text not null default 'fm-',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete restrict
);
alter table public.business_meta_pixels enable row level security;
revoke all on table public.business_meta_pixels from anon, authenticated;

create table public.meta_event_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  business_project_id uuid
    references public.business_projects(id) on delete set null,
  pixel_id text not null,
  event_name text not null,
  event_id text not null,
  event_time timestamptz not null,
  event_source_url text,
  visitor_id text,
  order_id uuid references public.commerce_orders(id) on delete set null,
  user_data jsonb not null default '{}'::jsonb,
  custom_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','sent','blocked','failed','dead')),
  attempts integer not null default 0,
  last_error text,
  response jsonb,
  blocked_reason text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (pixel_id, event_id),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete restrict
);
create index meta_event_queue_pending_idx
  on public.meta_event_queue (status, created_at)
  where status in ('pending','failed');
alter table public.meta_event_queue enable row level security;
revoke all on table public.meta_event_queue from anon, authenticated;

alter table public.integration_secrets
  drop constraint integration_secrets_provider_check;
alter table public.integration_secrets
  add constraint integration_secrets_provider_check check (provider in
    ('google_drive','google_drive_app','openai','anthropic','groq','openrouter',
     'cloudflare_r2','cloudflare_account','clamav','meta_ads','meta_ads_app',
     'railway','meta_capi'));

alter table public.integration_secrets
  drop constraint integration_secrets_kind_check;
alter table public.integration_secrets
  add constraint integration_secrets_kind_check check (
    kind in ('oauth_refresh_token','credential_bundle')
    or kind ~ '^oauth_access_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or kind ~ '^capi_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
