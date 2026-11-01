-- D-160: metricas de video dos insights diarios da Meta.
-- Preenchidas pela sincronizacao a partir dos campos video_*_watched_actions
-- e da acao video_view (visualizacao de 3 segundos) do array actions.
-- Nulas quando o anuncio nao e de video ou a Meta nao devolveu a metrica:
-- ausencia significa indisponivel, nunca zero.
alter table public.meta_ad_insights_daily
  add column if not exists video_views_3s bigint,
  add column if not exists video_thruplay_views bigint,
  add column if not exists video_p25_views bigint,
  add column if not exists video_p50_views bigint,
  add column if not exists video_p75_views bigint,
  add column if not exists video_p100_views bigint;
