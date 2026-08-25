alter table public.custom_domains
  add column disabled_at timestamptz,
  add column disabled_by_user_id uuid
    references public.users(id) on delete restrict;
