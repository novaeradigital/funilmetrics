-- Amplia a lista de provedores aceitos em integration_secrets.
-- anthropic e groq (D-172) e openrouter ficaram fora do check original,
-- o que fazia o salvamento dessas integracoes falhar e desfazer a transacao.
alter table public.integration_secrets
  drop constraint integration_secrets_provider_check;

alter table public.integration_secrets
  add constraint integration_secrets_provider_check
  check (provider in (
    'google_drive', 'google_drive_app', 'openai', 'anthropic', 'groq',
    'openrouter', 'cloudflare_r2', 'cloudflare_account', 'clamav',
    'meta_ads', 'meta_ads_app', 'railway'
  ));
