import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizations } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { findOrganizationSettings, updateOrganizationSettings } from '../src/queries/organization-settings.query';
import type { OrganizationSettingsRow } from '../src/queries/organization-settings.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const organizationSettingsQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(
  testDatabaseUrl,
  'organization_settings_query',
);
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  databaseUrl: organizationSettingsQueryDatabaseUrl,
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
const pool: Pool = createDatabasePool(organizationSettingsQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('organization settings db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: organizationSettingsQueryDatabaseUrl,
    db,
    pool,
  });

  it('reads the default inherited rollback retention policy for new organizations', async (): Promise<void> => {
    await createOrganization();

    await expect(findOrganizationSettings('org_123')).resolves.toEqual({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: null,
      rollbackRetentionMode: 'inherit',
    });
  });

  it('persists explicit rollback retention overrides', async (): Promise<void> => {
    await createOrganization();

    const updatedSettings: OrganizationSettingsRow = await updateOrganizationSettings({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: 3,
      rollbackRetentionMode: 'keep_last',
    });

    expect(updatedSettings).toEqual({
      auditRetentionDays: null,
      auditRetentionMode: 'inherit',
      organizationId: 'org_123',
      rollbackRetentionLimit: 3,
      rollbackRetentionMode: 'keep_last',
    });
    await expect(findOrganizationSettings('org_123')).resolves.toEqual(updatedSettings);
  });
});

async function createOrganization(): Promise<void> {
  await db.insert(organizations).values({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}
