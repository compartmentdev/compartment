import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { createDatabase, createDatabasePool, type Database } from './client';
import type { ApiDatabaseTransaction } from './client.types';
import { readRequiredDatabaseUrl } from './database-url';
import { parseTenantSecretsKek, parseVariablesMasterKey } from '../lib/variables-crypto';
import { migrateTenantSecretEnvelopes } from '../services/tenant-secret-migration.service';
import type {
  TenantSecretMigrationKeys,
  TenantSecretMigrationResult,
} from '../services/tenant-secret-migration.service.types';

export async function runMigrations(
  connectionString: string = readRequiredDatabaseUrl(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const pool: Pool = createDatabasePool(connectionString);
  const db: Database = createDatabase(pool);
  try {
    await migrate(db, {
      migrationsFolder: resolve(__dirname, '../../drizzle'),
    });
    const keys: TenantSecretMigrationKeys = readTenantSecretMigrationKeys(env);
    const result: TenantSecretMigrationResult = await db.transaction(
      async (tx: ApiDatabaseTransaction): Promise<TenantSecretMigrationResult> =>
        await migrateTenantSecretEnvelopes(tx, keys),
    );
    process.stdout.write(`${JSON.stringify({ event: 'tenant-secret-envelope-migration', ...result })}\n`);
  } finally {
    await pool.end();
  }
}

function readTenantSecretMigrationKeys(env: NodeJS.ProcessEnv): TenantSecretMigrationKeys {
  const currentKek: Buffer = parseTenantSecretsKek(readRequiredValue(env, 'COMPARTMENT_TENANT_SECRETS_KEK'));
  const sourceKeks: Buffer[] = [
    currentKek,
    parseVariablesMasterKey(readRequiredValue(env, 'COMPARTMENT_VARIABLES_MASTER_KEY')),
  ];
  const previousKek: string | undefined = env.COMPARTMENT_TENANT_SECRETS_PREVIOUS_KEK;
  if (previousKek !== undefined && previousKek !== '') {
    sourceKeks.push(parseTenantSecretsKek(previousKek));
  }
  return { currentKek, sourceKeks };
}

function readRequiredValue(env: NodeJS.ProcessEnv, variableName: string): string {
  const value: string | undefined = env[variableName];
  if (value === undefined || value === '') {
    throw new Error(`${variableName} is required.`);
  }
  return value;
}

if (require.main === module) {
  void runMigrations();
}
