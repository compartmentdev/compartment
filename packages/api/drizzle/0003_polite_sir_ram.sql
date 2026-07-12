CREATE TABLE "resource_reconcile_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_resource_id" text NOT NULL,
	"intent_json" text NOT NULL,
	"expected_claims_json" text NOT NULL,
	"previous_manifest_json" text,
	"operation_type" text NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp with time zone,
	"phase" text NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_resources" ADD COLUMN "runtime_kind" text DEFAULT 'node' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_resources" ADD COLUMN "expected_claims_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_reconcile_runs" ADD CONSTRAINT "resource_reconcile_runs_project_resource_id_project_resources_id_fk" FOREIGN KEY ("project_resource_id") REFERENCES "public"."project_resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_job_runs" ADD COLUMN "volume_mounts_json" text DEFAULT '[]' NOT NULL;
