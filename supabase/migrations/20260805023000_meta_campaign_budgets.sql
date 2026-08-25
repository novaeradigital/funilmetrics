alter table public.meta_campaigns
  add column if not exists daily_budget_minor bigint,
  add column if not exists lifetime_budget_minor bigint;

comment on column public.meta_campaigns.daily_budget_minor is
  'Orcamento diario da campanha em unidade monetaria minima, conforme Meta Graph API.';
comment on column public.meta_campaigns.lifetime_budget_minor is
  'Orcamento total da campanha em unidade monetaria minima, conforme Meta Graph API.';
