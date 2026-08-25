CREATE TYPE "public"."commerce_order_status" AS ENUM('abandoned', 'pending', 'approved', 'expired', 'cancelled', 'refund_requested', 'refunded', 'chargeback');--> statement-breakpoint
CREATE TYPE "public"."data_scope" AS ENUM('production', 'test', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."identifier_type" AS ENUM('email', 'phone', 'lastlink_buyer_id');--> statement-breakpoint
CREATE TYPE "public"."normalized_event_type" AS ENUM('checkout_abandoned', 'payment_pending', 'payment_approved', 'payment_request_expired', 'payment_request_cancelled', 'refund_requested', 'payment_refunded', 'payment_chargeback');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'expired', 'cancelled', 'refund_requested', 'refunded', 'chargeback');--> statement-breakpoint
ALTER TYPE "public"."raw_event_processing_status" ADD VALUE 'processing' BEFORE 'quarantined';--> statement-breakpoint
ALTER TYPE "public"."raw_event_processing_status" ADD VALUE 'normalized' BEFORE 'quarantined';--> statement-breakpoint
CREATE TABLE "commerce_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"data_scope" "data_scope" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_offers_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"person_id" uuid,
	"offer_id" uuid,
	"data_scope" "data_scope" NOT NULL,
	"external_key" text NOT NULL,
	"status" "commerce_order_status" NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"original_amount" numeric(18, 2),
	"paid_amount" numeric(18, 2),
	"occurred_at" timestamp with time zone,
	"occurred_at_raw" text,
	"occurred_at_basis" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_orders_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "commerce_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"data_scope" "data_scope" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_products_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "normalized_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"data_scope" "data_scope" NOT NULL,
	"type" "normalized_event_type" NOT NULL,
	"external_event_name" text NOT NULL,
	"amount" numeric(18, 2),
	"financial_effect" numeric(18, 2) DEFAULT '0' NOT NULL,
	"occurred_at" timestamp with time zone,
	"occurred_at_raw" text,
	"occurred_at_basis" text NOT NULL,
	"rule_version" text NOT NULL,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_attributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"utm_id" text,
	"src" text,
	"sck" text,
	"vtid" text,
	"origin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"data_scope" "data_scope" NOT NULL,
	"external_payment_id" text,
	"status" "payment_status" NOT NULL,
	"method" text,
	"installments" integer,
	"approved_amount" numeric(18, 2),
	"reversed_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"data_scope" "data_scope" NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_id_scope_unique" UNIQUE("id","organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "person_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"connection_id" uuid,
	"data_scope" "data_scope" NOT NULL,
	"type" "identifier_type" NOT NULL,
	"normalized_value" text NOT NULL,
	"raw_value" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce_offers" ADD CONSTRAINT "commerce_offers_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_order_scope_fk" FOREIGN KEY ("order_id","organization_id","project_id") REFERENCES "public"."commerce_orders"("id","organization_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_product_scope_fk" FOREIGN KEY ("product_id","organization_id","project_id") REFERENCES "public"."commerce_products"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_person_scope_fk" FOREIGN KEY ("person_id","organization_id","project_id") REFERENCES "public"."people"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_offer_scope_fk" FOREIGN KEY ("offer_id","organization_id","project_id") REFERENCES "public"."commerce_offers"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_payment_events" ADD CONSTRAINT "normalized_payment_events_raw_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_payment_events" ADD CONSTRAINT "normalized_payment_events_order_scope_fk" FOREIGN KEY ("order_id","organization_id","project_id") REFERENCES "public"."commerce_orders"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalized_payment_events" ADD CONSTRAINT "normalized_payment_events_payment_scope_fk" FOREIGN KEY ("payment_id","organization_id","project_id") REFERENCES "public"."payments"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_raw_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attributions" ADD CONSTRAINT "order_attributions_order_scope_fk" FOREIGN KEY ("order_id","organization_id","project_id") REFERENCES "public"."commerce_orders"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_scope_fk" FOREIGN KEY ("order_id","organization_id","project_id") REFERENCES "public"."commerce_orders"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_project_org_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifiers" ADD CONSTRAINT "person_identifiers_person_scope_fk" FOREIGN KEY ("person_id","organization_id","project_id") REFERENCES "public"."people"("id","organization_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identifiers" ADD CONSTRAINT "person_identifiers_connection_scope_fk" FOREIGN KEY ("connection_id","organization_id","project_id") REFERENCES "public"."connections"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_offers_external_uidx" ON "commerce_offers" USING btree ("connection_id","data_scope","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_order_items_order_product_uidx" ON "commerce_order_items" USING btree ("order_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_external_uidx" ON "commerce_orders" USING btree ("connection_id","data_scope","external_key");--> statement-breakpoint
CREATE INDEX "commerce_orders_scope_status_idx" ON "commerce_orders" USING btree ("organization_id","project_id","data_scope","status");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_products_external_uidx" ON "commerce_products" USING btree ("connection_id","data_scope","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "normalized_payment_events_raw_uidx" ON "normalized_payment_events" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "normalized_payment_events_scope_occurred_idx" ON "normalized_payment_events" USING btree ("organization_id","project_id","data_scope","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_attributions_raw_uidx" ON "order_attributions" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "order_attributions_utm_idx" ON "order_attributions" USING btree ("organization_id","project_id","utm_source","utm_campaign");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_order_uidx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_uidx" ON "payments" USING btree ("connection_id","data_scope","external_payment_id") WHERE "payments"."external_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "people_scope_idx" ON "people" USING btree ("organization_id","project_id","data_scope");--> statement-breakpoint
CREATE UNIQUE INDEX "person_identifiers_value_uidx" ON "person_identifiers" USING btree ("organization_id","project_id","data_scope","type","normalized_value");--> statement-breakpoint
CREATE INDEX "person_identifiers_person_idx" ON "person_identifiers" USING btree ("person_id");

-- A camada normalizada é acessada inicialmente apenas pelo backend.
-- RLS permanece habilitado sem políticas para anon/authenticated.
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.normalized_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attributions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.people FROM anon, authenticated;
REVOKE ALL ON TABLE public.person_identifiers FROM anon, authenticated;
REVOKE ALL ON TABLE public.commerce_products FROM anon, authenticated;
REVOKE ALL ON TABLE public.commerce_offers FROM anon, authenticated;
REVOKE ALL ON TABLE public.commerce_orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.commerce_order_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.normalized_payment_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.order_attributions FROM anon, authenticated;

COMMENT ON COLUMN public.normalized_payment_events.data_scope IS
  'Somente production pode contribuir para métricas financeiras; test e unknown têm efeito financeiro zero.';
