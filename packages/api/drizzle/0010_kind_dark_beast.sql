CREATE TABLE "organization_quota_reconciliation" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp with time zone,
	"failure_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_quota_reconciliation" ADD CONSTRAINT "organization_quota_reconciliation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_quota_reconciliation_state_lease_idx" ON "organization_quota_reconciliation" USING btree ("state","lease_expires_at");