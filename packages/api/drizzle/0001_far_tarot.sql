CREATE TABLE "job_usage_checkpoints" (
	"source_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_usage_hourly" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"service_id" text NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"job_class" text NOT NULL,
	"duration_seconds" bigint DEFAULT 0 NOT NULL,
	"job_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workload_usage_checkpoints" (
	"pod_uid" text PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workload_usage_hourly" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"service_id" text,
	"resource_id" text,
	"hour_bucket" timestamp with time zone NOT NULL,
	"cpu_millicore_seconds" bigint DEFAULT 0 NOT NULL,
	"memory_byte_seconds" bigint DEFAULT 0 NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workload_usage_hourly_owner_check" CHECK (num_nonnulls("workload_usage_hourly"."service_id", "workload_usage_hourly"."resource_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "product_job_runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "job_usage_checkpoints_created_at_idx" ON "job_usage_checkpoints" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_usage_hourly_bucket_idx" ON "job_usage_hourly" USING btree ("organization_id","project_id","environment_id","service_id","hour_bucket","job_class");--> statement-breakpoint
CREATE INDEX "job_usage_hourly_retention_idx" ON "job_usage_hourly" USING btree ("hour_bucket");--> statement-breakpoint
CREATE INDEX "workload_usage_checkpoints_updated_at_idx" ON "workload_usage_checkpoints" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workload_usage_hourly_application_bucket_idx" ON "workload_usage_hourly" USING btree ("organization_id","project_id","environment_id","service_id","hour_bucket") WHERE "workload_usage_hourly"."service_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workload_usage_hourly_resource_bucket_idx" ON "workload_usage_hourly" USING btree ("organization_id","project_id","environment_id","resource_id","hour_bucket") WHERE "workload_usage_hourly"."resource_id" is not null;--> statement-breakpoint
CREATE INDEX "workload_usage_hourly_bucket_idx" ON "workload_usage_hourly" USING btree ("hour_bucket");