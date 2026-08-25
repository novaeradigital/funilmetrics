-- Multi-currency financial foundation. Additive only: original Meta values remain immutable.
create type public.currency_conversion_status as enum (
  'converted','pending_rate','missing_currency','unsupported_currency',
  'conversion_error','not_required'
);

alter table public.meta_ad_accounts
  add column if not exists currency_status text not null default 'unconfirmed',
  add column if not exists currency_source text,
  add column if not exists currency_confirmed_at timestamptz,
  add column if not exists currency_confirmed_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists currency_updated_at timestamptz;

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null,
  from_currency text not null check (from_currency ~ '^[A-Z]{3}$'),
  to_currency text not null check (to_currency ~ '^[A-Z]{3}$'),
  rate numeric(24,12) not null check (rate > 0),
  source text not null,
  source_version text not null,
  rule_version text not null,
  source_rate_date date not null,
  source_reference jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(rate_date,from_currency,to_currency,source,source_version,rule_version)
);

create index exchange_rates_lookup_idx on public.exchange_rates
  (from_currency,to_currency,rate_date desc,source,rule_version);

alter table public.meta_ad_insights_daily
  add column if not exists spend_original numeric(18,6),
  add column if not exists original_currency text,
  add column if not exists spend_base numeric(18,6),
  add column if not exists base_currency text,
  add column if not exists exchange_rate numeric(24,12),
  add column if not exists exchange_rate_date date,
  add column if not exists exchange_rate_source text,
  add column if not exists exchange_rate_source_version text,
  add column if not exists conversion_rule_version text,
  add column if not exists conversion_status public.currency_conversion_status not null default 'pending_rate',
  add column if not exists conversion_error_code text,
  add column if not exists converted_at timestamptz;

create index meta_ad_insights_conversion_pending_idx on public.meta_ad_insights_daily
  (project_id,metric_date,conversion_status)
  where conversion_status in ('pending_rate','missing_currency','conversion_error');

create table public.currency_conversion_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  status text not null check (status in ('queued','running','completed','partial','failed')),
  trigger_kind text not null check (trigger_kind in ('sync','manual_currency_correction','backfill','retry')),
  rule_version text not null,
  rows_considered integer not null default 0,
  rows_converted integer not null default 0,
  rows_pending integer not null default 0,
  rows_failed integer not null default 0,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(project_id,organization_id) references public.projects(id,organization_id) on delete restrict
);

create index currency_conversion_runs_project_idx on public.currency_conversion_runs
  (project_id,created_at desc);

alter table public.exchange_rates enable row level security;
alter table public.currency_conversion_runs enable row level security;
revoke all on table public.exchange_rates from anon,authenticated;
revoke all on table public.currency_conversion_runs from anon,authenticated;

comment on column public.meta_ad_insights_daily.spend is
  'Original amount reported by Meta in the account currency; never overwrite with converted value.';
comment on column public.meta_ad_insights_daily.spend_base is
  'Converted spend in the project base currency, populated only by a versioned conversion rule.';
comment on table public.exchange_rates is
  'Immutable, versioned historical exchange-rate observations. source_rate_date records prior-business-day fallback.';
