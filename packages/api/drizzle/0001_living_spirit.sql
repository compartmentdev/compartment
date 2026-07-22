ALTER TABLE "resource_backups" ADD COLUMN "retention_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_backups" ADD COLUMN "retention_failure_summary" text;--> statement-breakpoint
ALTER TABLE "resource_backups" ADD COLUMN "retention_next_attempt_at" timestamp with time zone;