ALTER TABLE "build_artifacts" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD COLUMN "build_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD COLUMN "build_owner_deployment_id" text;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD COLUMN "sbom_digest" text;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_fingerprint_unique" UNIQUE("fingerprint");
