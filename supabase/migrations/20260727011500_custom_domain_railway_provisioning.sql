alter table public.custom_domains
  add column railway_custom_domain_id text,
  add column traffic_dns_type text,
  add column traffic_dns_host text,
  add column traffic_dns_value text,
  add column provider_verification_dns_host text,
  add column provider_verification_dns_value text,
  add column certificate_status text,
  add column provisioned_at timestamptz,
  add column last_health_checked_at timestamptz;

create unique index custom_domains_railway_id_uidx
  on public.custom_domains(railway_custom_domain_id)
  where railway_custom_domain_id is not null;

alter table public.custom_domains
  add constraint custom_domains_traffic_dns_type_check
  check (
    traffic_dns_type is null
    or traffic_dns_type in ('CNAME', 'A', 'ALIAS')
  );
