-- Pastas de criativos: organizacao da Biblioteca por projeto.
create table if not exists public.creative_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
alter table public.creatives
  add column if not exists folder_id uuid references public.creative_folders(id) on delete set null;
create index if not exists creatives_folder_idx on public.creatives (folder_id);
alter table public.creative_folders enable row level security;
revoke all on public.creative_folders from anon, authenticated;
