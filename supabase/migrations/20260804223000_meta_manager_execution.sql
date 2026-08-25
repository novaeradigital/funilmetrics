alter table public.meta_manager_action_requests
  add column execution_status text not null default 'not_started'
    check (execution_status in ('not_started','executing','succeeded','failed','state_mismatch')),
  add column execution_attempts integer not null default 0 check (execution_attempts >= 0),
  add column execution_started_at timestamptz,
  add column executed_at timestamptz,
  add column executed_by_user_id uuid references public.users(id) on delete restrict,
  add column actual_state jsonb,
  add column response_sanitized jsonb,
  add column error_code text;

create index meta_manager_actions_execution_idx
  on public.meta_manager_action_requests(project_id,execution_status,created_at desc);
