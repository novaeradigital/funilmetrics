-- Projetos de negocio (D-174): agrupamento de contas, conexoes de
-- pagamento, produtos e criativos para filtrar o Dashboard e o Melhores
-- Anuncios quando mais de uma operacao roda no mesmo projeto do sistema.
-- E um rotulo de leitura: nao separa dados, integracoes nem sincronizacoes.
create table if not exists public.business_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
alter table public.meta_ad_accounts
  add column if not exists business_project_id uuid references public.business_projects(id) on delete set null;
alter table public.connections
  add column if not exists business_project_id uuid references public.business_projects(id) on delete set null;
alter table public.commerce_products
  add column if not exists business_project_id uuid references public.business_projects(id) on delete set null;
alter table public.creatives
  add column if not exists business_project_id uuid references public.business_projects(id) on delete set null;
create index if not exists meta_ad_accounts_business_idx on public.meta_ad_accounts (business_project_id);
create index if not exists connections_business_idx on public.connections (business_project_id);
create index if not exists commerce_products_business_idx on public.commerce_products (business_project_id);
create index if not exists creatives_business_idx on public.creatives (business_project_id);
alter table public.business_projects enable row level security;
revoke all on public.business_projects from anon, authenticated;
