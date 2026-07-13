CREATE TABLE "deployment_product_logs" (
	"deployment_id" text NOT NULL,
	"pod_uid" text NOT NULL,
	"pod_name" text NOT NULL,
	"namespace" text NOT NULL,
	"container_name" text NOT NULL,
	"restart_identity" text NOT NULL,
	"source_offset" integer NOT NULL,
	"source_fingerprint" text NOT NULL,
	"stream" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_log_store_quota" (
	"id" text PRIMARY KEY NOT NULL,
	"used_bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "product_log_store_quota" ("id", "used_bytes") VALUES ('global', 0);
--> statement-breakpoint
CREATE FUNCTION decrement_product_log_store_usage() RETURNS trigger AS $$
BEGIN
  UPDATE "product_log_store_quota"
  SET "used_bytes" = GREATEST(0, "used_bytes" - octet_length(OLD."message") - 1024)
  WHERE "id" = 'global';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deployment_product_logs_quota_delete
AFTER DELETE ON "deployment_product_logs"
FOR EACH ROW EXECUTE FUNCTION decrement_product_log_store_usage();
--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD CONSTRAINT "deployment_product_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_product_logs_deployment_occurred_at_idx" ON "deployment_product_logs" USING btree ("deployment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_product_logs_identity_offset_idx" ON "deployment_product_logs" USING btree ("pod_uid","container_name","restart_identity","source_offset","source_fingerprint");--> statement-breakpoint
CREATE INDEX "deployment_product_logs_captured_at_idx" ON "deployment_product_logs" USING btree ("captured_at");
