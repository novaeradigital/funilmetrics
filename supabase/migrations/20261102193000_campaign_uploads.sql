-- D-169 a D-173: modulo Campanhas. Modelos de subida, subidas
-- (publicacoes) e itens da publicacao (campanha, conjunto e anuncio
-- criados na Meta), com idempotencia por item para a retentativa nao
-- duplicar nada na conta de anuncio.

create table public.campaign_upload_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  name text not null check (length(name) between 1 and 120),
  config jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);

create index campaign_upload_templates_project_idx
  on public.campaign_upload_templates(project_id,updated_at desc);

create table public.campaign_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  template_id uuid references public.campaign_upload_templates(id) on delete set null,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft','queued','publishing','completed','partial','failed','cancelled')),
  send_mode text not null default 'draft'
    check (send_mode in ('draft','paused','active')),
  config jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);

create index campaign_uploads_project_status_idx
  on public.campaign_uploads(project_id,status,created_at desc);

create table public.campaign_upload_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  upload_id uuid not null references public.campaign_uploads(id) on delete cascade,
  account_external_id text not null,
  level text not null check (level in ('campaign','adset','ad')),
  name text not null,
  creative_id uuid,
  parent_item_id uuid references public.campaign_upload_items(id) on delete cascade,
  external_id text,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending','creating','created','failed','skipped')),
  copy jsonb,
  payload jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict,
  unique(upload_id,idempotency_key)
);

create index campaign_upload_items_upload_idx
  on public.campaign_upload_items(upload_id,level,status);

alter table public.campaign_upload_templates enable row level security;
alter table public.campaign_uploads enable row level security;
alter table public.campaign_upload_items enable row level security;
revoke all on table public.campaign_upload_templates from anon,authenticated;
revoke all on table public.campaign_uploads from anon,authenticated;
revoke all on table public.campaign_upload_items from anon,authenticated;
