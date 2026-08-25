alter table public.experiment_exposures
  add column entry_hostname text;

create index experiment_exposures_hostname_idx
  on public.experiment_exposures(project_id,entry_hostname,exposed_at desc)
  where entry_hostname is not null;
