DROP INDEX "git_provider_registrations_active_owner_unique";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "provider_installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "access_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "access_token_encryption_key_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "provider_webhook_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_gitlab_organization_owner_unique" ON "git_provider_registrations" USING btree ("provider_type","provider_host","repository_owner",substring("webhook_url" from '/organizations/([^/]+)/registrations/')) WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'gitlab';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_owner_unique" ON "git_provider_registrations" USING btree ("provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'github_app';