ALTER TABLE "projects" ADD COLUMN "default_access_mode" text DEFAULT 'authenticated' NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "default_access_mode" DROP DEFAULT;
