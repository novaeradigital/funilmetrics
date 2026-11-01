-- D-159: escopo da execucao de sincronizacao da Meta.
-- 'full' = catalogo + insights de 30 dias (comportamento historico).
-- 'insights' = somente os numeros dos ultimos 3 dias, sem catalogo,
-- usado pela atualizacao rapida disparada do painel.
alter table public.meta_sync_runs
  add column if not exists sync_scope text not null default 'full';

do $$
begin
  alter table public.meta_sync_runs
    add constraint meta_sync_runs_sync_scope_check
    check (sync_scope in ('full', 'insights'));
exception
  when duplicate_object then null;
end $$;
