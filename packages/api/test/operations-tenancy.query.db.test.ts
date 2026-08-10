import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizations } from '../src/db/schema';
import { insertOperationRecord, updateOperationRecord } from '../src/queries/operations.query';
import type { OperationRecord } from '../src/queries/operations.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'operations_tenancy_query');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl,
  rollbackRetentionLimit: 5,
});
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('operation tenancy', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await db.insert(organizations).values([
        { id: 'org_owner', name: 'Owner', slug: 'owner' },
        { id: 'org_other', name: 'Other', slug: 'other' },
      ]);
    },
  });

  it('refuses to update an operation from another organization context', async (): Promise<void> => {
    const operation: OperationRecord = await insertOperationRecord({
      organizationId: 'org_owner',
      status: 'running',
      summary: 'Stopping project shop/production',
      targetId: 'env_owner',
      targetType: 'environment',
      type: 'deployment.stop',
    });

    await expect(
      updateOperationRecord({
        operationId: operation.id,
        organizationId: 'org_other',
        status: 'failed',
        summary: 'tampered',
      }),
    ).rejects.toThrow('Failed to update operation record.');

    await expect(
      updateOperationRecord({
        operationId: operation.id,
        organizationId: 'org_owner',
        status: 'succeeded',
        summary: 'Stopped project shop/production',
      }),
    ).resolves.toMatchObject({
      organizationId: 'org_owner',
      status: 'succeeded',
      summary: 'Stopped project shop/production',
    });
  });
});
