-- Importacoes genericas de criativos: upload manual e link publico do Drive.
-- A versao de um criativo pode nao vir do Drive (upload manual ou link).
alter table public.creative_versions
  alter column source_drive_file_id drop not null;

create table if not exists public.creative_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  folder_id uuid references public.creative_folders(id) on delete set null,
  source text not null check (source in ('upload', 'drive_link')),
  created_by_user_id uuid,
  status text not null default 'processing',
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.creative_import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.creative_import_jobs(id) on delete cascade,
  organization_id uuid not null,
  project_id uuid not null,
  source text not null check (source in ('upload', 'drive_link')),
  display_name text not null,
  mime_type text,
  size_bytes bigint,
  staging_key text,
  content_sha256 text,
  drive_file_id text,
  status text not null default 'pending',
  error_code text,
  creative_id uuid,
  asset_id uuid,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creative_import_items_claim_idx
  on public.creative_import_items (status, created_at);
create index if not exists creative_import_items_job_idx
  on public.creative_import_items (job_id);

alter table public.creative_import_jobs enable row level security;
alter table public.creative_import_items enable row level security;
revoke all on public.creative_import_jobs from anon, authenticated;
revoke all on public.creative_import_items from anon, authenticated;
