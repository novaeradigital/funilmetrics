create table public.dashboard_ai_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  dashboard_id uuid references public.dashboards(id) on delete set null,
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  model text not null,
  prompt text not null check(length(prompt) between 10 and 1000),
  proposal jsonb not null,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  estimated_cost_brl numeric(18,6),
  created_at timestamptz not null default now(),
  foreign key(project_id,organization_id)
    references public.projects(id,organization_id) on delete restrict
);
create index dashboard_ai_requests_project_month_idx
  on public.dashboard_ai_requests(project_id,created_at);
alter table public.dashboard_ai_requests enable row level security;
revoke all on table public.dashboard_ai_requests from anon,authenticated;
