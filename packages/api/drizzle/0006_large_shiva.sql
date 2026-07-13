DROP INDEX "deployment_product_logs_identity_offset_idx";--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
UPDATE "deployment_product_logs"
SET "source_fingerprint" =
  md5(concat_ws(E'\x1f', "pod_uid", "container_name", "restart_identity", "source_offset"::text, "occurred_at"::text, "message")) ||
  md5(concat_ws(E'\x1f', 'p7', "pod_uid", "container_name", "restart_identity", "source_offset"::text, "occurred_at"::text, "message"));--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ALTER COLUMN "source_fingerprint" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_product_logs_identity_offset_idx" ON "deployment_product_logs" USING btree ("pod_uid","container_name","restart_identity","source_offset","source_fingerprint");
