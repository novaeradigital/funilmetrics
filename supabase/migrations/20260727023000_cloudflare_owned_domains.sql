alter table public.integration_secrets
  drop constraint if exists integration_secrets_provider_check;
alter table public.integration_secrets
  add constraint integration_secrets_provider_check check (
    provider in ('google_drive','google_drive_app','openai','cloudflare_r2',
      'cloudflare_account','clamav','meta_ads','railway')
  );

alter table public.custom_domains
  add column if not exists dns_provider text not null default 'railway',
  add column if not exists cloudflare_zone_id text,
  add column if not exists cloudflare_zone_name text,
  add column if not exists cloudflare_zone_status text,
  add column if not exists cloudflare_name_servers jsonb not null default '[]'::jsonb,
  add column if not exists cloudflare_checked_at timestamptz;

alter table public.custom_domains
  add constraint custom_domains_dns_provider_check
  check (dns_provider in ('railway','cloudflare_owned'));

create unique index if not exists custom_domains_cloudflare_zone_uidx
  on public.custom_domains(cloudflare_zone_id)
  where cloudflare_zone_id is not null;
