import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  auditLogs,
  connections,
  commerceOffers,
  commerceOrderItems,
  commerceOrders,
  commerceProducts,
  creativeAssets,
  creativeEditorialMetadata,
  creativeTagAssignments,
  creativeTags,
  creatives,
  creativeVersions,
  dataQualityIssues,
  driveConnections,
  driveFiles,
  driveFolders,
  driveImportItems,
  driveImportJobs,
  integrationSecrets,
  memberships,
  normalizedPaymentEvents,
  orderAttributions,
  organizations,
  payments,
  people,
  personIdentifiers,
  projectMemberships,
  projects,
  rawEvents,
  users,
  webhookEndpoints,
} from "./schema.js";

describe("schema organizacional", () => {
  it("mantém nomes estáveis para as tabelas iniciais", () => {
    expect(
      [
        organizations,
        projects,
        users,
        memberships,
        projectMemberships,
        auditLogs,
        connections,
        webhookEndpoints,
        rawEvents,
        people,
        personIdentifiers,
        commerceProducts,
        dataQualityIssues,
        commerceOffers,
        commerceOrders,
        commerceOrderItems,
        payments,
        normalizedPaymentEvents,
        orderAttributions,
        driveConnections,
        driveFolders,
        driveFiles,
        creativeAssets,
        creativeEditorialMetadata,
        creativeTags,
        creativeTagAssignments,
        creatives,
        creativeVersions,
        driveImportJobs,
        driveImportItems,
        integrationSecrets,
      ].map((table) => getTableConfig(table).name),
    ).toEqual([
      "organizations",
      "projects",
      "users",
      "memberships",
      "project_memberships",
      "audit_logs",
      "connections",
      "webhook_endpoints",
      "raw_events",
      "people",
      "person_identifiers",
      "commerce_products",
      "data_quality_issues",
      "commerce_offers",
      "commerce_orders",
      "commerce_order_items",
      "payments",
      "normalized_payment_events",
      "order_attributions",
      "drive_connections",
      "drive_folders",
      "drive_files",
      "creative_assets",
      "creative_editorial_metadata",
      "creative_tags",
      "creative_tag_assignments",
      "creatives",
      "creative_versions",
      "drive_import_jobs",
      "drive_import_items",
      "integration_secrets",
    ]);
  });

  it("exige organização nos registros com escopo organizacional", () => {
    for (const table of [
      projects,
      memberships,
      projectMemberships,
      auditLogs,
      connections,
      rawEvents,
      people,
      personIdentifiers,
      commerceProducts,
      dataQualityIssues,
      commerceOffers,
      commerceOrders,
      commerceOrderItems,
      payments,
      normalizedPaymentEvents,
      orderAttributions,
      driveConnections,
      driveFolders,
      driveFiles,
      creativeAssets,
      creatives,
      creativeVersions,
      driveImportJobs,
      driveImportItems,
      integrationSecrets,
    ]) {
      const organizationColumn = getTableConfig(table).columns.find(
        (column) => column.name === "organization_id",
      );

      expect(organizationColumn?.notNull).toBe(true);
    }
  });

  it("mantém o payload de auditoria separado entre antes e depois", () => {
    const columns = getTableConfig(auditLogs).columns.map(
      (column) => column.name,
    );

    expect(columns).toContain("before");
    expect(columns).toContain("after");
    expect(columns).toContain("occurred_at");
  });

  it("mantém corpo bruto e idempotência na entrada", () => {
    const columns = getTableConfig(rawEvents).columns.map(
      (column) => column.name,
    );

    expect(columns).toContain("body_raw");
    expect(columns).toContain("body_sha256");
    expect(columns).toContain("idempotency_key");
    expect(columns).toContain("parser_version");
  });
});
