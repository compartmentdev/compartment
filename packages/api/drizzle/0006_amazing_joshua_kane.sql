ALTER TABLE "build_artifacts" ADD COLUMN "sbom_json" text;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD COLUMN "sbom_image_digest" text;
