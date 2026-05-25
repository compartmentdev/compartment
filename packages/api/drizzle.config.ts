import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  get dbCredentials(): { url: string } {
    return {
      url: readRequiredDrizzleDatabaseUrl(),
    };
  },
  verbose: true,
  strict: true,
});

function readRequiredDrizzleDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const connectionString: string | undefined = env.COMPARTMENT_DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === '') {
    throw new Error('COMPARTMENT_DATABASE_URL is required.');
  }

  return connectionString;
}
