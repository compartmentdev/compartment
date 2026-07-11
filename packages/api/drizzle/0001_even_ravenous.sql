CREATE TABLE "deployment_kube_references" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"namespace" text NOT NULL,
	"deployment_name" text NOT NULL,
	"service_name" text NOT NULL,
	"network_policy_names_json" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone,
	"transitioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_kube_references_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
ALTER TABLE "deployment_kube_references" ADD CONSTRAINT "deployment_kube_references_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployment_kube_references_state_updated_at_idx" ON "deployment_kube_references" USING btree ("state","updated_at");