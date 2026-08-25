CREATE TYPE "public"."connection_status" AS ENUM('active', 'inactive', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."raw_event_processing_status" AS ENUM('received', 'duplicate', 'queued', 'quarantined', 'failed_retryable', 'failed_terminal');--> statement-breakpoint
CREATE TYPE "public"."raw_event_validation_status" AS ENUM('pending', 'valid', 'partial', 'invalid', 'unknown_event');--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"configuration" jsonb,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"external_event_name" text,
	"is_test" boolean,
	"method" text NOT NULL,
	"content_type" text NOT NULL,
	"allowed_headers" jsonb,
	"body_raw" text NOT NULL,
	"body_json" jsonb,
	"body_sha256" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"idempotency_strategy" text NOT NULL,
	"created_at_raw" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_status" "raw_event_processing_status" DEFAULT 'received' NOT NULL,
	"validation_status" "raw_event_validation_status" DEFAULT 'pending' NOT NULL,
	"parser_version" text NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"previous_token_hash" text,
	"previous_token_valid_until" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connections_public_id_uidx" ON "connections" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "connections_organization_project_idx" ON "connections" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "connections_provider_status_idx" ON "connections" USING btree ("provider","status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_connection_idempotency_uidx" ON "raw_events" USING btree ("connection_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_connection_external_id_uidx" ON "raw_events" USING btree ("connection_id","external_event_id") WHERE "raw_events"."external_event_id" is not null;--> statement-breakpoint
CREATE INDEX "raw_events_scope_received_idx" ON "raw_events" USING btree ("organization_id","project_id","received_at");--> statement-breakpoint
CREATE INDEX "raw_events_processing_status_idx" ON "raw_events" USING btree ("processing_status","received_at");--> statement-breakpoint
CREATE INDEX "raw_events_external_name_idx" ON "raw_events" USING btree ("connection_id","external_event_name","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_public_id_uidx" ON "webhook_endpoints" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_connection_uidx" ON "webhook_endpoints" USING btree ("connection_id");