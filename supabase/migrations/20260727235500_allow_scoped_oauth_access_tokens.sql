alter table "public"."integration_secrets"
  drop constraint if exists "integration_secrets_kind_check";

alter table "public"."integration_secrets"
  add constraint "integration_secrets_kind_check" check (
    "kind" in ('oauth_refresh_token', 'credential_bundle')
    or "kind" ~ '^oauth_access_token:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

comment on constraint "integration_secrets_kind_check"
  on "public"."integration_secrets" is
  'Permite bundles, refresh tokens e access tokens OAuth isolados pelo UUID da conexão.';
