-- Inteligencia (fase 1, D-186): formato na analise do criativo, limiares
-- das regras por projeto, estado dos cartoes (dispensar/adiar) e historico
-- do chat da pagina.

alter table public.creative_analyses
  add column if not exists format text;

create table if not exists public.intelligence_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  business_project_id uuid,
  thresholds jsonb not null default '{}'::jsonb,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists intelligence_settings_scope_idx
  on public.intelligence_settings (
    project_id,
    coalesce(business_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.intelligence_card_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  business_project_id uuid,
  creative_id uuid not null,
  verdict text not null,
  state text not null check (state in ('dismissed', 'snoozed')),
  snooze_until timestamptz,
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists intelligence_card_states_card_idx
  on public.intelligence_card_states (project_id, creative_id, verdict);

create table if not exists public.intelligence_chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists intelligence_chat_messages_thread_idx
  on public.intelligence_chat_messages (project_id, user_id, created_at);
