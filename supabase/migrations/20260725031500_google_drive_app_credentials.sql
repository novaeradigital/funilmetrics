alter table "public"."integration_secrets"
  drop constraint "integration_secrets_provider_check";

alter table "public"."integration_secrets"
  add constraint "integration_secrets_provider_check"
  check (
    "provider" in (
      'google_drive',
      'google_drive_app',
      'openai',
      'cloudflare_r2',
      'clamav'
    )
  );
