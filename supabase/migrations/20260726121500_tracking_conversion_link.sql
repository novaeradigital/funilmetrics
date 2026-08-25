create table public.tracking_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  tracking_source_id uuid not null references public.tracking_sources(id) on delete restrict,
  visitor_id text not null,
  order_id uuid not null unique references public.commerce_orders(id) on delete restrict,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);
create index tracking_conversions_source_idx
  on public.tracking_conversions(tracking_source_id,first_observed_at desc);
alter table public.tracking_conversions enable row level security;
revoke all on table public.tracking_conversions from anon,authenticated;
