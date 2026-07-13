CREATE TABLE "deployment_product_logs" (
	"deployment_id" text NOT NULL,
	"pod_uid" text NOT NULL,
	"pod_name" text NOT NULL,
	"namespace" text NOT NULL,
	"container_name" text NOT NULL,
	"restart_identity" text NOT NULL,
	"source_offset" integer NOT NULL,
	"stream" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD CONSTRAINT "deployment_product_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_product_logs_deployment_occurred_at_idx" ON "deployment_product_logs" USING btree ("deployment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_product_logs_identity_offset_idx" ON "deployment_product_logs" USING btree ("pod_uid","container_name","restart_identity","source_offset","occurred_at");--> statement-breakpoint
CREATE INDEX "deployment_product_logs_captured_at_idx" ON "deployment_product_logs" USING btree ("captured_at");
