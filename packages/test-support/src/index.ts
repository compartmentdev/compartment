import { hasText } from '@compartment/utils';
import { Pool, type QueryResult } from 'pg';
import { createMaintenanceDatabaseUrl, readDatabaseName } from './database-url';

export async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const databaseName: string = readDatabaseName(databaseUrl);
  const maintenancePool: Pool = createPoolFromUrl(createMaintenanceDatabaseUrl(databaseUrl));
  try {
    await createDatabaseIfMissing(maintenancePool, databaseName);
  } catch (error) {
    const databaseError: Error | null = error instanceof Error ? error : null;

    throw createEnsureDatabaseExistsError(databaseUrl, databaseError);
  } finally {
    await maintenancePool.end();
  }
}

export async function resetDatabase(databaseUrl: string): Promise<void> {
  const pool: Pool = createPoolFromUrl(databaseUrl);
  try {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await pool.query('create schema drizzle');
    await pool.query('grant all on schema public to public');
  } finally {
    await pool.end();
  }
}

function createEnsureDatabaseExistsError(databaseUrl: string, error: Error | null): Error {
  const message: string = error?.message ?? 'Unknown PostgreSQL error.';

  return new Error(
    `Failed to prepare test database ${describeDatabaseTarget(databaseUrl)}. ` +
      `Ensure COMPARTMENT_TEST_DATABASE_URL points to a reachable PostgreSQL instance with valid credentials. ` +
      `Original error: ${message}`,
    {
      cause: error ?? undefined,
    },
  );
}

function describeDatabaseTarget(databaseUrl: string): string {
  const url: URL = new URL(databaseUrl);
  const databaseName: string = readDatabaseName(databaseUrl);
  const socketHost: string | null = url.searchParams.get('host');
  const host: string = socketHost ?? url.host;
  const hostLabel: string = hasText(host) ? host : 'default host';
  return `${databaseName} on ${hostLabel}`;
}

async function createDatabaseIfMissing(maintenancePool: Pool, databaseName: string): Promise<void> {
  if (!(await databaseExists(maintenancePool, databaseName))) {
    await maintenancePool.query(`create database "${databaseName}"`);
  }
}

async function databaseExists(maintenancePool: Pool, databaseName: string): Promise<boolean> {
  const result: QueryResult<{
    exists: boolean;
  }> = await maintenancePool.query<{
    exists: boolean;
  }>('select exists(select 1 from pg_database where datname = $1) as exists', [databaseName]);

  return result.rows[0]?.exists === true;
}

function createPoolFromUrl(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
  });
}

export { readDatabaseTestMode } from './database-test-mode';
export { deriveTestDatabaseUrl } from './database-url-variants';
export { cleanupDockerTestNamespacesByPrefix, createDockerTestNamespace } from './docker-namespace';
export { readFileModePermissions } from './file-mode';
export { findFreePort } from './free-port';
export { runCompartmentApiMigrations } from './api-migrations';
export { readSocketSafeTempRootDirectory } from './test-temp-root';
