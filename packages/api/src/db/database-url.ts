import { hasText } from '@compartment/utils';

export function readRequiredDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const connectionString: string | undefined = env.COMPARTMENT_DATABASE_URL;
  if (!hasText(connectionString)) {
    throw new Error('COMPARTMENT_DATABASE_URL is required.');
  }

  return connectionString;
}
