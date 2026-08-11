CREATE TABLE "signup_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_idempotency_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "signup_idempotency_keys" ADD CONSTRAINT "signup_idempotency_keys_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;