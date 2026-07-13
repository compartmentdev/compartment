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
