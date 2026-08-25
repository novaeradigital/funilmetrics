import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "administrator",
  "editor",
  "analyst",
  "viewer",
]);

export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "suspended",
  "disabled",
]);

export const connectionStatus = pgEnum("connection_status", [
  "active",
  "inactive",
  "error",
  "revoked",
]);

export const rawEventProcessingStatus = pgEnum("raw_event_processing_status", [
  "received",
  "duplicate",
  "queued",
  "processing",
  "normalized",
  "quarantined",
  "failed_retryable",
  "failed_terminal",
]);

export const dataScope = pgEnum("data_scope", [
  "production",
  "test",
  "unknown",
]);

export const identifierType = pgEnum("identifier_type", [
  "email",
  "phone",
  "lastlink_buyer_id",
]);

export const commerceOrderStatus = pgEnum("commerce_order_status", [
  "abandoned",
  "pending",
  "approved",
  "expired",
  "cancelled",
  "refund_requested",
  "refunded",
  "chargeback",
]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "approved",
  "expired",
  "cancelled",
  "refund_requested",
  "refunded",
  "chargeback",
]);

export const creativeStatus = pgEnum("creative_status", [
  "new", "imported", "analyzing", "awaiting_approval", "approved",
  "ready_to_publish", "published", "paused", "winner", "fatigued", "archived",
]);
export const customDomainStatus = pgEnum("custom_domain_status", [
  "pending_dns", "verified", "provisioning", "active", "error", "disabled",
]);

export const driveSourceStatus = pgEnum("drive_source_status", [
  "active", "permission_removed", "missing", "removed", "disconnected",
]);

export const driveImportJobStatus = pgEnum("drive_import_job_status", [
  "pending", "inventorying", "importing", "completed",
  "completed_with_errors", "failed", "cancelled",
]);

export const driveImportItemStatus = pgEnum("drive_import_item_status", [
  "pending", "downloading", "quarantined", "scanning", "imported",
  "skipped_unchanged", "rejected_format", "rejected_size",
  "failed_retryable", "failed_terminal",
]);

export const malwareScanStatus = pgEnum("malware_scan_status", [
  "pending", "scanning", "clean", "infected", "unsupported",
  "failed_retryable", "failed_terminal",
]);

export const creativeTagSource = pgEnum("creative_tag_source", [
  "manual",
  "ai",
]);

export const normalizedEventType = pgEnum("normalized_event_type", [
  "checkout_abandoned",
  "payment_pending",
  "payment_approved",
  "payment_request_expired",
  "payment_request_cancelled",
  "refund_requested",
  "payment_refunded",
  "payment_chargeback",
]);

export const rawEventValidationStatus = pgEnum("raw_event_validation_status", [
  "pending",
  "valid",
  "partial",
  "invalid",
  "unknown_event",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: uuid("auth_user_id"),
    email: text("email").notNull(),
    displayName: text("display_name"),
    status: userStatus("status").default("invited").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_auth_user_id_uidx")
      .on(table.authUserId)
      .where(sql`${table.authUserId} is not null`),
    uniqueIndex("users_email_normalized_uidx").on(sql`lower(${table.email})`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").default("America/Sao_Paulo").notNull(),
    currency: text("currency").default("BRL").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("projects_id_organization_unique").on(table.id, table.organizationId),
    uniqueIndex("projects_organization_slug_uidx").on(
      table.organizationId,
      table.slug,
    ),
    index("projects_organization_idx").on(table.organizationId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("memberships_id_organization_unique").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("memberships_organization_user_uidx").on(
      table.organizationId,
      table.userId,
    ),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    roleOverride: membershipRole("role_override"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "project_memberships_pk",
      columns: [table.projectId, table.membershipId],
    }),
    foreignKey({
      name: "project_memberships_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_memberships_membership_org_fk",
      columns: [table.membershipId, table.organizationId],
      foreignColumns: [memberships.id, memberships.organizationId],
    }).onDelete("cascade"),
    index("project_memberships_organization_idx").on(table.organizationId),
    index("project_memberships_membership_idx").on(table.membershipId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("drive_connections_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "audit_logs_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    index("audit_logs_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    index("audit_logs_project_occurred_idx").on(
      table.projectId,
      table.occurredAt,
    ),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
  ],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: uuid("public_id").defaultRandom().notNull(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    status: connectionStatus("status").default("active").notNull(),
    configuration: jsonb("configuration"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("connections_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    uniqueIndex("connections_public_id_uidx").on(table.publicId),
    foreignKey({
      name: "connections_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    index("connections_organization_project_idx").on(
      table.organizationId,
      table.projectId,
    ),
    index("connections_provider_status_idx").on(table.provider, table.status),
  ],
);

export const customDomains = pgTable(
  "custom_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    hostname: text("hostname").notNull().unique(),
    status: customDomainStatus("status").default("pending_dns").notNull(),
    verificationToken: text("verification_token").notNull(),
    verificationCheckedAt: timestamp("verification_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    provisioningRequestedAt: timestamp("provisioning_requested_at", { withTimezone: true }),
    provisioningRequestedByUserId: uuid("provisioning_requested_by_user_id"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledByUserId: uuid("disabled_by_user_id"),
    railwayCustomDomainId: text("railway_custom_domain_id"),
    dnsProvider: text("dns_provider").default("railway").notNull(),
    cloudflareZoneId: text("cloudflare_zone_id"),
    cloudflareZoneName: text("cloudflare_zone_name"),
    cloudflareZoneStatus: text("cloudflare_zone_status"),
    cloudflareNameServers: jsonb("cloudflare_name_servers").default([]).notNull(),
    cloudflareCheckedAt: timestamp("cloudflare_checked_at", { withTimezone: true }),
    trafficDnsType: text("traffic_dns_type"),
    trafficDnsHost: text("traffic_dns_host"),
    trafficDnsValue: text("traffic_dns_value"),
    providerVerificationDnsHost: text("provider_verification_dns_host"),
    providerVerificationDnsValue: text("provider_verification_dns_value"),
    certificateStatus: text("certificate_status"),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    lastHealthCheckedAt: timestamp("last_health_checked_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_domains_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "custom_domains_creator_fk",
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "custom_domains_provisioner_fk",
      columns: [table.provisioningRequestedByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "custom_domains_disabler_fk",
      columns: [table.disabledByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    uniqueIndex("custom_domains_railway_id_uidx")
      .on(table.railwayCustomDomainId)
      .where(sql`${table.railwayCustomDomainId} is not null`),
    index("custom_domains_cloudflare_zone_idx")
      .on(table.projectId, table.cloudflareZoneId)
      .where(sql`${table.cloudflareZoneId} is not null`),
    index("custom_domains_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const dataQualityIssues = pgTable(
  "data_quality_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id"),
    issueKey: text("issue_key").notNull(),
    issueType: text("issue_type").notNull(),
    severity: text("severity").notNull(),
    status: text("status").default("open").notNull(),
    title: text("title").notNull(),
    evidence: jsonb("evidence").notNull(),
    ruleVersion: text("rule_version").notNull(),
    occurrences: integer("occurrences").default(1).notNull(),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    unique("drive_folders_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "data_quality_issues_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "data_quality_issues_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("data_quality_issues_open_key_uidx")
      .on(table.projectId, table.issueKey)
      .where(sql`${table.status} = 'open'`),
    index("data_quality_issues_scope_status_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
      table.lastDetectedAt,
    ),
    index("data_quality_issues_connection_idx").on(
      table.connectionId,
      table.status,
    ),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: uuid("public_id").defaultRandom().notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    previousTokenHash: text("previous_token_hash"),
    previousTokenValidUntil: timestamp("previous_token_valid_until", {
      withTimezone: true,
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("webhook_endpoints_public_id_uidx").on(table.publicId),
    uniqueIndex("webhook_endpoints_connection_uidx").on(table.connectionId),
  ],
);

export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    source: text("source").notNull(),
    externalEventId: text("external_event_id"),
    externalEventName: text("external_event_name"),
    isTest: boolean("is_test"),
    method: text("method").notNull(),
    contentType: text("content_type").notNull(),
    allowedHeaders: jsonb("allowed_headers"),
    bodyRaw: text("body_raw").notNull(),
    bodyJson: jsonb("body_json"),
    bodySha256: text("body_sha256").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    idempotencyStrategy: text("idempotency_strategy").notNull(),
    createdAtRaw: text("created_at_raw"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processingStatus: rawEventProcessingStatus("processing_status")
      .default("received")
      .notNull(),
    validationStatus: rawEventValidationStatus("validation_status")
      .default("pending")
      .notNull(),
    parserVersion: text("parser_version").notNull(),
    processingAttempts: integer("processing_attempts").default(0).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (table) => [
    foreignKey({
      name: "raw_events_connection_scope_fk",
      columns: [
        table.connectionId,
        table.organizationId,
        table.projectId,
      ],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("raw_events_connection_idempotency_uidx").on(
      table.connectionId,
      table.idempotencyKey,
    ),
    uniqueIndex("raw_events_connection_external_id_uidx")
      .on(table.connectionId, table.externalEventId)
      .where(sql`${table.externalEventId} is not null`),
    index("raw_events_scope_received_idx").on(
      table.organizationId,
      table.projectId,
      table.receivedAt,
    ),
    index("raw_events_processing_status_idx").on(
      table.processingStatus,
      table.receivedAt,
    ),
    index("raw_events_external_name_idx").on(
      table.connectionId,
      table.externalEventName,
      table.receivedAt,
    ),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    scope: dataScope("data_scope").notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("people_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "people_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    index("people_scope_idx").on(
      table.organizationId,
      table.projectId,
      table.scope,
    ),
  ],
);

export const personIdentifiers = pgTable(
  "person_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    personId: uuid("person_id").notNull(),
    connectionId: uuid("connection_id"),
    scope: dataScope("data_scope").notNull(),
    type: identifierType("type").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    rawValue: text("raw_value"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "person_identifiers_person_scope_fk",
      columns: [table.personId, table.organizationId, table.projectId],
      foreignColumns: [people.id, people.organizationId, people.projectId],
    }).onDelete("cascade"),
    foreignKey({
      name: "person_identifiers_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("person_identifiers_value_uidx").on(
      table.organizationId,
      table.projectId,
      table.scope,
      table.type,
      table.normalizedValue,
    ),
    index("person_identifiers_person_idx").on(table.personId),
  ],
);

export const commerceProducts = pgTable(
  "commerce_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    scope: dataScope("data_scope").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("commerce_products_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "commerce_products_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commerce_products_external_uidx").on(
      table.connectionId,
      table.scope,
      table.externalId,
    ),
  ],
);

export const commerceOffers = pgTable(
  "commerce_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    scope: dataScope("data_scope").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("commerce_offers_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "commerce_offers_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commerce_offers_external_uidx").on(
      table.connectionId,
      table.scope,
      table.externalId,
    ),
  ],
);

export const commerceOrders = pgTable(
  "commerce_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    personId: uuid("person_id"),
    offerId: uuid("offer_id"),
    scope: dataScope("data_scope").notNull(),
    externalKey: text("external_key").notNull(),
    status: commerceOrderStatus("status").notNull(),
    currency: text("currency").default("BRL").notNull(),
    originalAmount: numeric("original_amount", { precision: 18, scale: 2 }),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    occurredAtRaw: text("occurred_at_raw"),
    occurredAtBasis: text("occurred_at_basis").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("commerce_orders_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "commerce_orders_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_orders_person_scope_fk",
      columns: [table.personId, table.organizationId, table.projectId],
      foreignColumns: [people.id, people.organizationId, people.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_orders_offer_scope_fk",
      columns: [table.offerId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceOffers.id,
        commerceOffers.organizationId,
        commerceOffers.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commerce_orders_external_uidx").on(
      table.connectionId,
      table.scope,
      table.externalKey,
    ),
    index("commerce_orders_scope_status_idx").on(
      table.organizationId,
      table.projectId,
      table.scope,
      table.status,
    ),
  ],
);

export const commerceOrderItems = pgTable(
  "commerce_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_order_items_order_scope_fk",
      columns: [table.orderId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceOrders.id,
        commerceOrders.organizationId,
        commerceOrders.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "commerce_order_items_product_scope_fk",
      columns: [table.productId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceProducts.id,
        commerceProducts.organizationId,
        commerceProducts.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commerce_order_items_order_product_uidx").on(
      table.orderId,
      table.productId,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    orderId: uuid("order_id").notNull(),
    scope: dataScope("data_scope").notNull(),
    externalPaymentId: text("external_payment_id"),
    status: paymentStatus("status").notNull(),
    method: text("method"),
    installments: integer("installments"),
    approvedAmount: numeric("approved_amount", { precision: 18, scale: 2 }),
    reversedAmount: numeric("reversed_amount", { precision: 18, scale: 2 })
      .default("0")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("payments_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "payments_connection_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [
        connections.id,
        connections.organizationId,
        connections.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "payments_order_scope_fk",
      columns: [table.orderId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceOrders.id,
        commerceOrders.organizationId,
        commerceOrders.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("payments_order_uidx").on(table.orderId),
    uniqueIndex("payments_external_uidx")
      .on(table.connectionId, table.scope, table.externalPaymentId)
      .where(sql`${table.externalPaymentId} is not null`),
  ],
);

export const normalizedPaymentEvents = pgTable(
  "normalized_payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    rawEventId: uuid("raw_event_id").notNull(),
    orderId: uuid("order_id").notNull(),
    paymentId: uuid("payment_id"),
    scope: dataScope("data_scope").notNull(),
    type: normalizedEventType("type").notNull(),
    externalEventName: text("external_event_name").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }),
    financialEffect: numeric("financial_effect", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    saleAmount: numeric("sale_amount", { precision: 18, scale: 2 }),
    saleFinancialEffect: numeric("sale_financial_effect", {
      precision: 18,
      scale: 2,
    })
      .default("0")
      .notNull(),
    producerCommissionAmount: numeric("producer_commission_amount", {
      precision: 18,
      scale: 2,
    }),
    producerCommissionFinancialEffect: numeric(
      "producer_commission_financial_effect",
      { precision: 18, scale: 2 },
    )
      .default("0")
      .notNull(),
    commissionDataStatus: text("commission_data_status")
      .default("missing")
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    occurredAtRaw: text("occurred_at_raw"),
    occurredAtBasis: text("occurred_at_basis").notNull(),
    ruleVersion: text("rule_version").notNull(),
    warnings: jsonb("warnings"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "normalized_payment_events_raw_fk",
      columns: [table.rawEventId],
      foreignColumns: [rawEvents.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "normalized_payment_events_order_scope_fk",
      columns: [table.orderId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceOrders.id,
        commerceOrders.organizationId,
        commerceOrders.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "normalized_payment_events_payment_scope_fk",
      columns: [table.paymentId, table.organizationId, table.projectId],
      foreignColumns: [payments.id, payments.organizationId, payments.projectId],
    }).onDelete("restrict"),
    uniqueIndex("normalized_payment_events_raw_uidx").on(table.rawEventId),
    index("normalized_payment_events_scope_occurred_idx").on(
      table.organizationId,
      table.projectId,
      table.scope,
      table.occurredAt,
    ),
    index("normalized_payment_events_commission_status_idx").on(
      table.projectId,
      table.commissionDataStatus,
      table.occurredAt,
    ),
  ],
);

export const orderAttributions = pgTable(
  "order_attributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    rawEventId: uuid("raw_event_id").notNull(),
    orderId: uuid("order_id").notNull(),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    utmId: text("utm_id"),
    src: text("src"),
    sck: text("sck"),
    vtid: text("vtid"),
    originUrl: text("origin_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "order_attributions_raw_fk",
      columns: [table.rawEventId],
      foreignColumns: [rawEvents.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "order_attributions_order_scope_fk",
      columns: [table.orderId, table.organizationId, table.projectId],
      foreignColumns: [
        commerceOrders.id,
        commerceOrders.organizationId,
        commerceOrders.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("order_attributions_raw_uidx").on(table.rawEventId),
    index("order_attributions_utm_idx").on(
      table.organizationId,
      table.projectId,
      table.utmSource,
      table.utmCampaign,
    ),
  ],
);

export const integrationSecrets = pgTable(
  "integration_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    initializationVector: bytea("initialization_vector").notNull(),
    authenticationTag: bytea("authentication_tag").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => [
    unique("integration_secrets_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "integration_secrets_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    index("integration_secrets_scope_provider_idx").on(
      table.organizationId, table.projectId, table.provider,
    ),
  ],
);

export const driveConnections = pgTable(
  "drive_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    googleSubject: text("google_subject").notNull(),
    accountEmail: text("account_email"),
    grantedScopes: text("granted_scopes").array().default([]).notNull(),
    credentialSecretRef: uuid("credential_secret_ref").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "drive_connections_scope_fk",
      columns: [table.connectionId, table.organizationId, table.projectId],
      foreignColumns: [connections.id, connections.organizationId, connections.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_connections_secret_scope_fk",
      columns: [table.credentialSecretRef, table.organizationId, table.projectId],
      foreignColumns: [
        integrationSecrets.id,
        integrationSecrets.organizationId,
        integrationSecrets.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("drive_connections_connection_uidx").on(table.connectionId),
    uniqueIndex("drive_connections_subject_uidx").on(table.projectId, table.googleSubject),
  ],
);

export const driveFolders = pgTable(
  "drive_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    driveConnectionId: uuid("drive_connection_id").notNull(),
    driveFolderId: text("drive_folder_id").notNull(),
    name: text("name").notNull(),
    knownPath: text("known_path"),
    status: driveSourceStatus("status").default("active").notNull(),
    includeSubfolders: boolean("include_subfolders").default(true).notNull(),
    authorizedByUserId: uuid("authorized_by_user_id").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).defaultNow().notNull(),
    lastInventoryAt: timestamp("last_inventory_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "drive_folders_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_folders_connection_scope_fk",
      columns: [table.driveConnectionId, table.organizationId, table.projectId],
      foreignColumns: [
        driveConnections.id,
        driveConnections.organizationId,
        driveConnections.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_folders_authorizer_fk",
      columns: [table.authorizedByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    uniqueIndex("drive_folders_external_uidx").on(table.driveConnectionId, table.driveFolderId),
  ],
);

export const driveFiles = pgTable(
  "drive_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    driveFolderId: uuid("drive_folder_id").notNull(),
    externalFileId: text("external_file_id").notNull(),
    externalParentId: text("external_parent_id"),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    modifiedAtSource: timestamp("modified_at_source", { withTimezone: true }).notNull(),
    sourceChecksum: text("source_checksum"),
    status: driveSourceStatus("status").default("active").notNull(),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("drive_files_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "drive_files_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_files_folder_scope_fk",
      columns: [table.driveFolderId, table.organizationId, table.projectId],
      foreignColumns: [driveFolders.id, driveFolders.organizationId, driveFolders.projectId],
    }).onDelete("restrict"),
    uniqueIndex("drive_files_external_uidx").on(table.driveFolderId, table.externalFileId),
    index("drive_files_status_seen_idx").on(table.projectId, table.status, table.lastSeenAt),
  ],
);

export const creativeAssets = pgTable(
  "creative_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    objectKey: text("object_key").notNull(),
    storageProvider: text("storage_provider").default("cloudflare_r2").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    malwareStatus: malwareScanStatus("malware_status").default("pending").notNull(),
    malwareEngineVersion: text("malware_engine_version"),
    malwareSignaturesVersion: text("malware_signatures_version"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("creative_assets_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "creative_assets_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("creative_assets_hash_uidx").on(
      table.organizationId, table.projectId, table.contentSha256,
    ),
    uniqueIndex("creative_assets_object_key_uidx").on(table.objectKey),
  ],
);

export const creatives = pgTable(
  "creatives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    status: creativeStatus("status").default("new").notNull(),
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("creatives_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "creatives_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creatives_creator_fk",
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    index("creatives_scope_status_idx").on(table.organizationId, table.projectId, table.status),
  ],
);

export const creativeVersions = pgTable(
  "creative_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    creativeId: uuid("creative_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    sourceDriveFileId: uuid("source_drive_file_id").notNull(),
    assetId: uuid("asset_id").notNull(),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }).notNull(),
    contentSha256: text("content_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("creative_versions_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "creative_versions_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_versions_creative_scope_fk",
      columns: [table.creativeId, table.organizationId, table.projectId],
      foreignColumns: [creatives.id, creatives.organizationId, creatives.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_versions_drive_file_scope_fk",
      columns: [table.sourceDriveFileId, table.organizationId, table.projectId],
      foreignColumns: [driveFiles.id, driveFiles.organizationId, driveFiles.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_versions_asset_scope_fk",
      columns: [table.assetId, table.organizationId, table.projectId],
      foreignColumns: [
        creativeAssets.id,
        creativeAssets.organizationId,
        creativeAssets.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("creative_versions_number_uidx").on(table.creativeId, table.versionNumber),
    uniqueIndex("creative_versions_source_hash_uidx").on(
      table.sourceDriveFileId, table.contentSha256,
    ),
  ],
);

export const creativeEditorialMetadata = pgTable(
  "creative_editorial_metadata",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    creativeId: uuid("creative_id").notNull(),
    creativeVersionId: uuid("creative_version_id").notNull(),
    copyText: text("copy_text"),
    headline: text("headline"),
    cta: text("cta"),
    destinationUrl: text("destination_url"),
    notes: text("notes"),
    updatedByUserId: uuid("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("creative_editorial_metadata_scope_unique").on(
      table.creativeId,
      table.creativeVersionId,
    ),
    foreignKey({
      name: "creative_editorial_metadata_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_editorial_metadata_creative_scope_fk",
      columns: [table.creativeId, table.organizationId, table.projectId],
      foreignColumns: [creatives.id, creatives.organizationId, creatives.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_editorial_metadata_version_scope_fk",
      columns: [table.creativeVersionId, table.organizationId, table.projectId],
      foreignColumns: [
        creativeVersions.id,
        creativeVersions.organizationId,
        creativeVersions.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_editorial_metadata_updater_fk",
      columns: [table.updatedByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
  ],
);

export const creativeTags = pgTable(
  "creative_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("creative_tags_id_scope_unique").on(
      table.id,
      table.organizationId,
      table.projectId,
    ),
    foreignKey({
      name: "creative_tags_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_tags_creator_fk",
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    uniqueIndex("creative_tags_scope_name_uidx").on(
      table.organizationId,
      table.projectId,
      table.normalizedName,
    ),
  ],
);

export const creativeTagAssignments = pgTable(
  "creative_tag_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    creativeId: uuid("creative_id").notNull(),
    creativeVersionId: uuid("creative_version_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    source: creativeTagSource("source").default("manual").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    assignedByUserId: uuid("assigned_by_user_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "creative_tag_assignments_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_tag_assignments_creative_scope_fk",
      columns: [table.creativeId, table.organizationId, table.projectId],
      foreignColumns: [creatives.id, creatives.organizationId, creatives.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_tag_assignments_version_scope_fk",
      columns: [table.creativeVersionId, table.organizationId, table.projectId],
      foreignColumns: [
        creativeVersions.id,
        creativeVersions.organizationId,
        creativeVersions.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_tag_assignments_tag_scope_fk",
      columns: [table.tagId, table.organizationId, table.projectId],
      foreignColumns: [creativeTags.id, creativeTags.organizationId, creativeTags.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "creative_tag_assignments_assigner_fk",
      columns: [table.assignedByUserId],
      foreignColumns: [users.id],
    }).onDelete("set null"),
    index("creative_tag_assignments_creative_idx").on(
      table.creativeId,
      table.creativeVersionId,
      table.source,
    ),
  ],
);

export const driveImportJobs = pgTable(
  "drive_import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    driveFolderId: uuid("drive_folder_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: driveImportJobStatus("status").default("pending").notNull(),
    filesDetected: integer("files_detected").default(0).notNull(),
    filesImported: integer("files_imported").default(0).notNull(),
    filesSkipped: integer("files_skipped").default(0).notNull(),
    filesFailed: integer("files_failed").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("drive_import_jobs_id_scope_unique").on(
      table.id, table.organizationId, table.projectId,
    ),
    foreignKey({
      name: "drive_import_jobs_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_import_jobs_folder_scope_fk",
      columns: [table.driveFolderId, table.organizationId, table.projectId],
      foreignColumns: [driveFolders.id, driveFolders.organizationId, driveFolders.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_import_jobs_requester_fk",
      columns: [table.requestedByUserId],
      foreignColumns: [users.id],
    }).onDelete("restrict"),
    uniqueIndex("drive_import_jobs_idempotency_uidx").on(table.driveFolderId, table.idempotencyKey),
    index("drive_import_jobs_status_idx").on(table.status, table.createdAt),
  ],
);

export const driveImportItems = pgTable(
  "drive_import_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    projectId: uuid("project_id").notNull(),
    jobId: uuid("job_id").notNull(),
    driveFileId: uuid("drive_file_id").notNull(),
    status: driveImportItemStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    assetId: uuid("asset_id"),
    creativeVersionId: uuid("creative_version_id"),
    errorCode: text("error_code"),
    errorMessageSanitized: text("error_message_sanitized"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "drive_import_items_project_org_fk",
      columns: [table.projectId, table.organizationId],
      foreignColumns: [projects.id, projects.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_import_items_job_scope_fk",
      columns: [table.jobId, table.organizationId, table.projectId],
      foreignColumns: [
        driveImportJobs.id,
        driveImportJobs.organizationId,
        driveImportJobs.projectId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "drive_import_items_file_scope_fk",
      columns: [table.driveFileId, table.organizationId, table.projectId],
      foreignColumns: [driveFiles.id, driveFiles.organizationId, driveFiles.projectId],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_import_items_asset_scope_fk",
      columns: [table.assetId, table.organizationId, table.projectId],
      foreignColumns: [
        creativeAssets.id,
        creativeAssets.organizationId,
        creativeAssets.projectId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "drive_import_items_version_scope_fk",
      columns: [table.creativeVersionId, table.organizationId, table.projectId],
      foreignColumns: [
        creativeVersions.id,
        creativeVersions.organizationId,
        creativeVersions.projectId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("drive_import_items_job_file_uidx").on(table.jobId, table.driveFileId),
    index("drive_import_items_status_idx").on(table.status, table.updatedAt),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type CustomDomain = typeof customDomains.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type RawEvent = typeof rawEvents.$inferSelect;
export type NewRawEvent = typeof rawEvents.$inferInsert;
export type Person = typeof people.$inferSelect;
export type PersonIdentifier = typeof personIdentifiers.$inferSelect;
export type CommerceProduct = typeof commerceProducts.$inferSelect;
export type CommerceOffer = typeof commerceOffers.$inferSelect;
export type CommerceOrder = typeof commerceOrders.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type NormalizedPaymentEvent =
  typeof normalizedPaymentEvents.$inferSelect;
export type OrderAttribution = typeof orderAttributions.$inferSelect;
export type DriveConnection = typeof driveConnections.$inferSelect;
export type IntegrationSecret = typeof integrationSecrets.$inferSelect;
export type DriveFolder = typeof driveFolders.$inferSelect;
export type DriveFile = typeof driveFiles.$inferSelect;
export type CreativeAsset = typeof creativeAssets.$inferSelect;
export type Creative = typeof creatives.$inferSelect;
export type CreativeVersion = typeof creativeVersions.$inferSelect;
export type CreativeEditorialMetadata =
  typeof creativeEditorialMetadata.$inferSelect;
export type CreativeTag = typeof creativeTags.$inferSelect;
export type CreativeTagAssignment =
  typeof creativeTagAssignments.$inferSelect;
export type DriveImportJob = typeof driveImportJobs.$inferSelect;
export type DriveImportItem = typeof driveImportItems.$inferSelect;
