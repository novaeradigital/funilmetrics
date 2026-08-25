alter table "public"."integration_secrets"
  drop constraint "integration_secrets_provider_check";

alter table "public"."integration_secrets"
  add constraint "integration_secrets_provider_check"
  check (
    "provider" in (
      'google_drive',
      'openai',
      'cloudflare_r2',
      'clamav'
    )
  );

alter table "public"."integration_secrets"
  drop constraint "integration_secrets_kind_check";

alter table "public"."integration_secrets"
  add constraint "integration_secrets_kind_check"
  check ("kind" in ('oauth_refresh_token', 'credential_bundle'));
