ALTER TABLE "product_job_runs" ADD COLUMN "runtime_identity" text DEFAULT 'resource' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_kube_provisioning" ADD COLUMN "isolation_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "product_job_runs"
SET "runtime_identity" = 'project'
WHERE "job_class" = 'release'
	OR left("identity_id", length('resource_retention_')) = 'resource_retention_'
	OR right("identity_id", length('-artifact-verify')) = '-artifact-verify';
