create type public.custom_domain_status as enum
  ('pending_dns','verified','provisioning','active','error','disabled');

create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  hostname text not null,
  status public.custom_domain_status not null default 'pending_dns',
  verification_token text not null,
  verification_checked_at timestamptz,
  verified_at timestamptz,
  activated_at timestamptz,
  last_error_code text,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(hostname),
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict
);

create index custom_domains_project_idx
  on public.custom_domains(project_id,created_at desc);
alter table public.custom_domains enable row level security;
revoke all on table public.custom_domains from anon,authenticated;
