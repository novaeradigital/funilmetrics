-- Libera o armazenamento do token de webhook da Kiwify no cofre.
-- O token da Kiwify e a chave do HMAC que assina cada entrega, entao ele
-- fica criptografado em integration_secrets (provider 'kiwify', kind
-- 'webhook_token:<connection_id>'); os dois checks originais nao previam
-- nem o provedor nem esse tipo de segredo.
alter table public.integration_secrets
  drop constraint integration_secrets_provider_check;

alter table public.integration_secrets
  add constraint integration_secrets_provider_check
  check (provider in (
    'google_drive', 'google_drive_app', 'openai', 'anthropic', 'groq',
    'openrouter', 'cloudflare_r2', 'cloudflare_account', 'clamav',
    'meta_ads', 'meta_ads_app', 'railway', 'meta_capi', 'kiwify'
  ));

alter table public.integration_secrets
  drop constraint integration_secrets_kind_check;

alter table public.integration_secrets
  add constraint integration_secrets_kind_check
  check (
    kind in ('oauth_refresh_token', 'credential_bundle')
    or kind ~ '^oauth_access_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or kind ~ '^capi_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or kind ~ '^webhook_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
