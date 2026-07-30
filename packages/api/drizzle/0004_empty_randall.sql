CREATE TABLE "edge_traffic_usage_receipts" (
	"source_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edge_traffic_usage_receipts_source_id_batch_id_pk" PRIMARY KEY("source_id","batch_id")
);
--> statement-breakpoint
ALTER TABLE "workload_usage_hourly" ADD COLUMN "request_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workload_usage_hourly" ADD COLUMN "response_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workload_usage_hourly" ADD COLUMN "request_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workload_usage_hourly" ADD COLUMN "status_4xx_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workload_usage_hourly" ADD COLUMN "status_5xx_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "edge_traffic_usage_receipts_created_at_idx" ON "edge_traffic_usage_receipts" USING btree ("created_at");