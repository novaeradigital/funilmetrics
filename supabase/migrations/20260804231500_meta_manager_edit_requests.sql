alter table public.meta_manager_action_requests
  drop constraint if exists meta_manager_action_requests_action_type_check;

alter table public.meta_manager_action_requests
  add constraint meta_manager_action_requests_action_type_check
  check (action_type in ('activate','pause','update_name','update_budget'));
