-- Fonte ConfigCheckout (D-141): novos valores de enum exigidos pela
-- normalização das vendas do checkout próprio.
-- - identifier_type 'document': o CPF do comprador vira identificador
--   da pessoa, ao lado de e-mail e telefone.
-- - commerce_order_status e payment_status 'in_analysis' e 'failed':
--   o antifraude da fonte tem estado próprio (em análise) e a recusa
--   é um desfecho distinto de cancelamento e expiração.
ALTER TYPE "public"."identifier_type" ADD VALUE 'document';--> statement-breakpoint
ALTER TYPE "public"."commerce_order_status" ADD VALUE 'in_analysis';--> statement-breakpoint
ALTER TYPE "public"."commerce_order_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'in_analysis';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'failed';--> statement-breakpoint
