-- Integracao Madame Luna (checkout proprio): o provedor madame_luna
-- guarda o segredo do webhook no cofre (integration_secrets), como a
-- Kiwify. Amplia o check de provedores mantendo a lista atual.
alter table public.integration_secrets
  drop constraint integration_secrets_provider_check;

alter table public.integration_secrets
  add constraint integration_secrets_provider_check
  check (provider in (
    'google_drive', 'google_drive_app', 'openai', 'anthropic', 'groq',
    'openrouter', 'cloudflare_r2', 'cloudflare_account', 'clamav',
    'meta_ads', 'meta_ads_app', 'railway', 'meta_capi', 'kiwify',
    'madame_luna'
  ));
