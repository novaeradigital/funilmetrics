import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const expectedTables = [
  "audit_logs",
  "connections",
  "commerce_offers",
  "commerce_order_items",
  "commerce_orders",
  "commerce_products",
  "creative_assets",
  "creative_ai_jobs",
  "creative_analyses",
  "creative_editorial_metadata",
  "creative_tag_assignments",
  "creative_tags",
  "creative_text_extractions",
  "creative_transcripts",
  "creative_versions",
  "creatives",
  "data_quality_issues",
  "drive_connections",
  "drive_files",
  "drive_folders",
  "drive_import_items",
  "drive_import_jobs",
  "integration_secrets",
  "memberships",
  "organizations",
  "normalized_payment_events",
  "order_attributions",
  "payments",
  "people",
  "person_identifiers",
  "project_memberships",
  "projects",
  "raw_events",
  "users",
  "webhook_endpoints",
];

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

try {
  const tables = await pool.query(
    `select tablename
       from pg_tables
      where schemaname = 'public'
        and tablename = any($1::text[])
      order by tablename`,
    [expectedTables],
  );
  const policies = await pool.query(
    `select tablename, policyname
       from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`,
  );
  const authSummary = await pool.query(
    `select
       count(*)::integer as total,
       count(email_confirmed_at)::integer as confirmed
     from auth.users`,
  );
  const profileSummary = await pool.query(
    `select count(*)::integer as total
       from public.users`,
  );
  const tenantSummary = await pool.query(
    `select
       (select count(*)::integer from public.organizations) as organizations,
       (select count(*)::integer from public.projects) as projects,
       (select count(*)::integer from public.memberships) as memberships,
       (
         select count(*)::integer
         from public.memberships
         where role = 'owner'
       ) as owners`,
  );
  const ingestionSecurity = await pool.query(
    `select
       c.relname as table_name,
       c.relrowsecurity as rls_enabled
     from pg_class c
     inner join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1::text[])
     order by c.relname`,
    [[
      "connections",
      "raw_events",
      "webhook_endpoints",
      "people",
      "person_identifiers",
      "commerce_products",
      "commerce_offers",
      "commerce_orders",
      "commerce_order_items",
      "payments",
      "normalized_payment_events",
      "order_attributions",
      "data_quality_issues",
      "drive_connections",
      "drive_folders",
      "drive_files",
      "creative_assets",
      "creative_ai_jobs",
      "creative_analyses",
      "creative_editorial_metadata",
      "creative_tag_assignments",
      "creative_tags",
      "creative_text_extractions",
      "creative_transcripts",
      "creatives",
      "creative_versions",
      "drive_import_jobs",
      "drive_import_items",
      "integration_secrets",
    ]],
  );
  const lastlinkProcessing = await pool.query(
    `select processing_status, validation_status, count(*)::integer as total
       from public.raw_events
      where source = 'lastlink'
      group by processing_status, validation_status
      order by processing_status, validation_status`,
  );
  const normalizedSummary = await pool.query(
    `select data_scope, type, count(*)::integer as total,
            coalesce(sum(financial_effect), 0)::text as financial_effect
       from public.normalized_payment_events
      group by data_scope, type
      order by data_scope, type`,
  );
  const lastlinkProductSummary = await pool.query(
    `select c.name as connection, product.data_scope, product.name
       from public.connections c
       join public.commerce_products product on product.connection_id = c.id
      where c.provider = 'lastlink'
      order by c.name, product.data_scope, product.name`,
  );
  const integrationSummary = await pool.query(
    `select connection.provider, connection.status,
            connection.configuration->>'validationStatus' as validation_status,
            exists (
              select 1 from public.integration_secrets secret
               where secret.project_id = connection.project_id
                 and secret.provider = connection.provider
                 and secret.kind = 'credential_bundle'
                 and secret.rotated_at is null
            ) as has_active_secret
       from public.connections connection
      where connection.provider in (
        'google_drive_app', 'openai', 'cloudflare_r2', 'clamav'
      )
      order by connection.provider`,
  );
  const driveConnectionSummary = await pool.query(
    `select count(*)::integer as active_connections,
            count(*) filter (
              where secret.rotated_at is null
            )::integer as active_encrypted_tokens
       from public.drive_connections drive
       join public.integration_secrets secret
         on secret.id = drive.credential_secret_ref
      where drive.disconnected_at is null`,
  );
  const driveInventorySummary = await pool.query(
    `select job.id, job.status, job.files_detected, job.files_imported,
            job.files_skipped, job.files_failed, job.error_code,
            folder.name as folder_name, job.created_at, job.finished_at
       from public.drive_import_jobs job
       join public.drive_folders folder on folder.id = job.drive_folder_id
      order by job.created_at desc
      limit 10`,
  );

  process.stdout.write(
    `${JSON.stringify({
      tables: tables.rows.map(({ tablename }) => tablename),
      policyCount: policies.rowCount,
      policies: policies.rows,
      authUsers: authSummary.rows[0],
      internalProfiles: profileSummary.rows[0],
      tenant: tenantSummary.rows[0],
      ingestionSecurity: ingestionSecurity.rows,
      lastlinkProcessing: lastlinkProcessing.rows,
      normalizedSummary: normalizedSummary.rows,
      lastlinkProductSummary: lastlinkProductSummary.rows,
      integrations: integrationSummary.rows,
      googleDrive: driveConnectionSummary.rows[0],
      googleDriveInventories: driveInventorySummary.rows,
    })}\n`,
  );
} finally {
  await pool.end();
}
