DROP TRIGGER "deployment_product_logs_quota_delete" ON "deployment_product_logs";--> statement-breakpoint
DROP FUNCTION "decrement_product_log_store_usage"();--> statement-breakpoint
ALTER TABLE "product_log_store_quota" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "product_log_store_quota" CASCADE;--> statement-breakpoint
DROP INDEX "deployment_product_logs_captured_at_idx";--> statement-breakpoint
ALTER TABLE "deployment_product_logs" DROP COLUMN "captured_at";--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD COLUMN "app_key" text;--> statement-breakpoint
UPDATE "deployment_product_logs" AS "line"
SET "app_key" = COALESCE(
  (
    SELECT "reference"."deployment_name"
    FROM "deployment_kube_references" AS "reference"
    WHERE "reference"."deployment_id" = "line"."deployment_id"
  ),
  "line"."resource_id"
);--> statement-breakpoint
CREATE INDEX "deployment_product_logs_app_window_idx" ON "deployment_product_logs" USING btree ("app_key","occurred_at" DESC NULLS LAST,"source_offset" DESC NULLS LAST);--> statement-breakpoint
DELETE FROM "deployment_product_logs"
WHERE ctid IN (
  SELECT "ranked"."line_ctid"
  FROM (
    SELECT ctid AS "line_ctid",
      row_number() OVER (
        PARTITION BY "app_key"
        ORDER BY "occurred_at" DESC, "source_offset" DESC
      ) AS "line_rank"
    FROM "deployment_product_logs"
  ) AS "ranked"
  WHERE "ranked"."line_rank" > 1000
);--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ALTER COLUMN "app_key" SET NOT NULL;
