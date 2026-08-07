import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizations } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { insertOperationRecord, updateOperationRecord } from '../src/queries/operations.query';
import type { OperationRecord } from '../src/queries/operations.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'operations_tenancy_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl,
  edgeToken: 'test-edge-token',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  auditRetentionDays: 90,
  auditRetentionCleanupBatchSize: 1000,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 100,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: 5,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
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
