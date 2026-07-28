ALTER TABLE "system_domain_setup_state" ADD COLUMN "pending_tls_secret_name" text;--> statement-breakpoint
ALTER TABLE "system_domain_setup_state" DROP COLUMN "pending_caddy_mode";--> statement-breakpoint
ALTER TABLE "system_domain_setup_state" DROP COLUMN "pending_certificate_path";--> statement-breakpoint
ALTER TABLE "system_domain_setup_state" DROP COLUMN "pending_private_key_path";