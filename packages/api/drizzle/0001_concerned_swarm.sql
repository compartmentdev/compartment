CREATE TABLE "github_app_registration_credentials" (
	"registration_id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"app_name" text NOT NULL,
	"app_slug" text NOT NULL,
	"app_url" text NOT NULL,
	"installation_account_login" text NOT NULL,
	"installation_account_type" text NOT NULL,
	"installation_id" text NOT NULL,
	"private_key_pem_ciphertext" text NOT NULL,
	"private_key_pem_encryption_key_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gitlab_token_registration_credentials" (
	"registration_id" text PRIMARY KEY NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"access_token_encryption_key_id" text NOT NULL,
	"access_token_expires_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "git_provider_registrations_active_owner_unique";--> statement-breakpoint
DROP INDEX "git_provider_registrations_pending_owner_unique";--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "provider_installation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "app_name" text;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "app_slug" text;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "app_url" text;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "private_key_pem_ciphertext" text;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD COLUMN "private_key_pem_encryption_key_id" text;--> statement-breakpoint
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
ALTER TABLE "sources" ADD COLUMN "provider_webhook_id" text;--> statement-breakpoint
ALTER TABLE "github_app_registration_credentials" ADD CONSTRAINT "github_app_registration_credentials_registration_id_git_provider_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."git_provider_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_token_registration_credentials" ADD CONSTRAINT "gitlab_token_registration_credentials_registration_id_git_provider_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."git_provider_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_gitlab_account_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","provider_account_id") WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'gitlab';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'active' AND "git_provider_registrations"."provider_type" = 'github_app';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_pending_owner_unique" ON "git_provider_registrations" USING btree ("organization_id","provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'pending';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "git_provider_registrations"
		WHERE "provider_type" = 'github_app'
			AND "status" = 'active'
			AND (
				"app_id" IS NULL
				OR "app_name" IS NULL
				OR "app_slug" IS NULL
				OR "app_url" IS NULL
				OR "installation_account_login" IS NULL
				OR "installation_account_type" IS NULL
				OR "installation_id" IS NULL
				OR "private_key_pem_ciphertext" IS NULL
				OR "private_key_pem_encryption_key_id" IS NULL
			)
	) THEN
		RAISE EXCEPTION 'Cannot migrate incomplete active GitHub App registration credentials';
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "github_app_registration_credentials" (
	"registration_id",
	"app_id",
	"app_name",
	"app_slug",
	"app_url",
	"installation_account_login",
	"installation_account_type",
	"installation_id",
	"private_key_pem_ciphertext",
	"private_key_pem_encryption_key_id"
)
SELECT
	"id",
	"app_id",
	"app_name",
	"app_slug",
	"app_url",
	"installation_account_login",
	"installation_account_type",
	"installation_id",
	"private_key_pem_ciphertext",
	"private_key_pem_encryption_key_id"
FROM "git_provider_registrations"
WHERE "provider_type" = 'github_app' AND "status" = 'active';--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "app_id";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "app_name";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "app_slug";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "app_url";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "installation_account_login";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "installation_account_type";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "installation_id";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "private_key_pem_ciphertext";--> statement-breakpoint
ALTER TABLE "git_provider_registrations" DROP COLUMN "private_key_pem_encryption_key_id";
