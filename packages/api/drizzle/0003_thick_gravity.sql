ALTER TABLE "deployment_custom_domains" ADD COLUMN "reconcile_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "desired_generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "observed_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "observed_ingress_present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "observed_certificate_present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "observed_certificate_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "edge_routing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "deletion_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "reconcile_lease_id" text;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD COLUMN "reconcile_lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "deployment_custom_domains"
SET "reconcile_state" = CASE
  WHEN "ownership_status" = 'valid' AND "routing_status" = 'valid' THEN 'reconciling'
  WHEN "ownership_status" = 'invalid' OR "routing_status" = 'invalid' THEN 'failed'
  ELSE 'pending'
END;
