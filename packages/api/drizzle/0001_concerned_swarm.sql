DROP INDEX "git_provider_registrations_active_owner_unique";--> statement-breakpoint
DROP INDEX "git_provider_registrations_pending_owner_unique";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "provider_installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "organization_id" text;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "git_provider_registrations"
		WHERE "provider_type" <> 'github_app'
			OR regexp_match("webhook_url", '/organizations/([^/]+)/registrations/([^/]+)/webhook([?#].*)?$') IS NULL
			OR (regexp_match("webhook_url", '/organizations/([^/]+)/registrations/([^/]+)/webhook([?#].*)?$'))[2] <> "id"
			OR NOT EXISTS (
				SELECT 1
				FROM "organizations"
				WHERE "organizations"."id" = (regexp_match("git_provider_registrations"."webhook_url", '/organizations/([^/]+)/registrations/([^/]+)/webhook([?#].*)?$'))[1]
			)
	) THEN
		RAISE EXCEPTION 'Cannot backfill git_provider_registrations.organization_id from webhook_url';
	END IF;
END $$;--> statement-breakpoint
WITH "parsed_registrations" AS (
	SELECT "id", (regexp_match("webhook_url", '/organizations/([^/]+)/registrations/([^/]+)/webhook([?#].*)?$'))[1] AS "organization_id"
	FROM "git_provider_registrations"
)
UPDATE "git_provider_registrations"
SET "organization_id" = "parsed_registrations"."organization_id"
FROM "parsed_registrations"
WHERE "git_provider_registrations"."id" = "parsed_registrations"."id";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "provider_account_login" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "access_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "access_token_encryption_key_id" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "provider_webhook_id" text;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_gitlab_account_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","provider_account_id") WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'gitlab';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'github_app';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_pending_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_provider_type_check" CHECK ("git_provider_registrations"."provider_type" IN ('github_app', 'gitlab'));--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_credential_shape_check" CHECK ((
        "git_provider_registrations"."provider_type" = 'github_app'
        AND "git_provider_registrations"."access_token_ciphertext" IS NULL
        AND "git_provider_registrations"."access_token_encryption_key_id" IS NULL
        AND "git_provider_registrations"."access_token_expires_at" IS NULL
        AND "git_provider_registrations"."provider_account_id" IS NULL
        AND "git_provider_registrations"."provider_account_login" IS NULL
        AND (
          "git_provider_registrations"."status" IN ('pending', 'failed')
          OR (
            "git_provider_registrations"."status" = 'active'
            AND "git_provider_registrations"."app_id" IS NOT NULL
            AND "git_provider_registrations"."installation_id" IS NOT NULL
            AND "git_provider_registrations"."private_key_pem_ciphertext" IS NOT NULL
            AND "git_provider_registrations"."private_key_pem_encryption_key_id" IS NOT NULL
            AND "git_provider_registrations"."webhook_secret_ciphertext" IS NOT NULL
            AND "git_provider_registrations"."webhook_secret_encryption_key_id" IS NOT NULL
          )
        )
      ) OR (
        "git_provider_registrations"."provider_type" = 'gitlab'
        AND "git_provider_registrations"."status" = 'active'
        AND "git_provider_registrations"."bootstrap_state_id" IS NULL
        AND "git_provider_registrations"."pending_expires_at" IS NULL
        AND "git_provider_registrations"."app_id" IS NULL
        AND "git_provider_registrations"."app_name" IS NULL
        AND "git_provider_registrations"."app_slug" IS NULL
        AND "git_provider_registrations"."app_url" IS NULL
        AND "git_provider_registrations"."installation_account_login" IS NULL
        AND "git_provider_registrations"."installation_account_type" IS NULL
        AND "git_provider_registrations"."installation_id" IS NULL
        AND "git_provider_registrations"."private_key_pem_ciphertext" IS NULL
        AND "git_provider_registrations"."private_key_pem_encryption_key_id" IS NULL
        AND "git_provider_registrations"."provider_account_id" IS NOT NULL
        AND "git_provider_registrations"."provider_account_login" IS NOT NULL
        AND "git_provider_registrations"."access_token_ciphertext" IS NOT NULL
        AND "git_provider_registrations"."access_token_encryption_key_id" IS NOT NULL
        AND "git_provider_registrations"."webhook_secret_ciphertext" IS NOT NULL
        AND "git_provider_registrations"."webhook_secret_encryption_key_id" IS NOT NULL
      ));
