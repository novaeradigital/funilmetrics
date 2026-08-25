drop index if exists public.custom_domains_cloudflare_zone_uidx;

create index if not exists custom_domains_cloudflare_zone_idx
  on public.custom_domains(project_id, cloudflare_zone_id)
  where cloudflare_zone_id is not null;

