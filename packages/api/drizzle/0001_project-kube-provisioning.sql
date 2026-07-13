CREATE TABLE "project_kube_provisioning" (
	"project_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp with time zone,
	"failure_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_kube_provisioning" ADD CONSTRAINT "project_kube_provisioning_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "project_kube_provisioning" ("project_id") SELECT "id" FROM "projects";--> statement-breakpoint
CREATE INDEX "project_kube_provisioning_state_lease_idx" ON "project_kube_provisioning" USING btree ("state","lease_expires_at");
