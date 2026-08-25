create type public.campaign_action_simulation_status as enum
  ('validated','reconciliation_required');
create table public.campaign_action_simulations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  campaign_action_request_id uuid not null unique
    references public.campaign_action_requests(id) on delete restrict,
  status public.campaign_action_simulation_status not null,
  approved_snapshot_sha256 text not null,
  current_state jsonb not null,
  discrepancies jsonb not null default '[]'::jsonb,
  simulated_by_user_id uuid not null references public.users(id) on delete restrict,
  simulated_at timestamptz not null default now()
);
create index campaign_action_simulations_project_idx
  on public.campaign_action_simulations(project_id,simulated_at desc);
alter table public.campaign_action_simulations enable row level security;
revoke all on table public.campaign_action_simulations from anon,authenticated;
