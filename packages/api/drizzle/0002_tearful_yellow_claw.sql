CREATE TABLE "product_job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_class" text NOT NULL,
	"identity_id" text NOT NULL,
	"image" text NOT NULL,
	"command_json" text NOT NULL,
	"env_json" text NOT NULL,
	"namespace" text NOT NULL,
	"timeout_ms" integer NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"job_name" text,
	"pod_name" text,
	"logs" text,
	"completed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_job_runs_class_identity_idx" ON "product_job_runs" USING btree ("job_class","identity_id");--> statement-breakpoint
CREATE INDEX "product_job_runs_status_created_at_idx" ON "product_job_runs" USING btree ("status","created_at");