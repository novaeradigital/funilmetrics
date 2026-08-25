alter table public.custom_domains
  add column provisioning_requested_at timestamptz,
  add column provisioning_requested_by_user_id uuid
    references public.users(id) on delete restrict;
