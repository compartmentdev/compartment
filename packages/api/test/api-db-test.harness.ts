import type { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { ensureDatabaseExists, resetDatabase, runCompartmentApiMigrations } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { projectKubeProvisioning } from '../src/db/schema';
import { projectIsolationVersion } from '../src/queries/project-provisioning-policy';
import { clearApiRuntime, configureApiRuntime } from '../src/runtime/runtime';

interface ApiRuntimeDatabaseTestHarnessInput {
  apiConfig: ApiConfig;
  databaseUrl: string;
  db: Database;
  pool: Pool;
  setup?: (() => Promise<void> | void) | undefined;
}

async function ensureApiTestDatabase(databaseUrl: string): Promise<void> {
  await ensureDatabaseExists(databaseUrl);
}

async function resetApiTestDatabase(databaseUrl: string): Promise<void> {
  await resetDatabase(databaseUrl);
  await runCompartmentApiMigrations(databaseUrl);
}

export function useApiDatabaseTestHarness(databaseUrl: string): void {
  beforeAll(async (): Promise<void> => {
    await ensureApiTestDatabase(databaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetApiTestDatabase(databaseUrl);
  });
}

export function useApiRuntimeDatabaseTestHarness(input: ApiRuntimeDatabaseTestHarnessInput): void {
  beforeAll(async (): Promise<void> => {
    await ensureApiTestDatabase(input.databaseUrl);
  });

  beforeEach(async (): Promise<void> => {
    await resetApiTestDatabase(input.databaseUrl);
    configureApiRuntime({
      config: input.apiConfig,
      db: input.db,
    });
    if (input.setup !== undefined) {
      await input.setup();
    }
  });

  afterEach((): void => {
    clearApiRuntime();
  });

  afterAll(async (): Promise<void> => {
    await input.pool.end();
  });
}

export async function seedCurrentProjectProvisioning(db: Database, projectId: string): Promise<void> {
  await db
    .insert(projectKubeProvisioning)
    .values({ isolationVersion: projectIsolationVersion, projectId, state: 'succeeded' });
}
