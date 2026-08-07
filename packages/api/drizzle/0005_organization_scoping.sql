DROP INDEX "git_provider_registrations_active_owner_unique";--> statement-breakpoint
DROP INDEX "git_provider_registrations_pending_owner_unique";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "git_provider_registrations" SET "organization_id" = substring("webhook_url" from '/v1/sources/git/providers/github/organizations/([^/]+)/registrations/[^/]+/webhook$');--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_pending_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'pending';
