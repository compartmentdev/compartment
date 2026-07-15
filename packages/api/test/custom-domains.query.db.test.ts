import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { type ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  deploymentCustomDomains,
  environments,
  organizations,
  principals,
  projects,
  projectServices,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { deleteCustomDomain, updateCustomDomainCheck } from '../src/queries/custom-domains.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const customDomainsQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'custom_domains_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  customTlsDirectory: '/etc/compartment/tls',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl: customDomainsQueryDatabaseUrl,
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
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(customDomainsQueryDatabaseUrl);
const db: Database = createDatabase(pool);

describe('custom domain db queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl: customDomainsQueryDatabaseUrl,
    db,
    pool,
  });

  it('guards custom-domain updates and deletes by stable row id', async (): Promise<void> => {
    await createQueryTestScope();
    await insertCustomDomain('cdom_old');

    await updateCustomDomainCheck({
      failureMessage: null,
      host: 'app.customer.example.com',
      id: 'cdom_recreated',
      lastCheckedAt: new Date('2026-04-23T10:00:00.000Z'),
      ownershipStatus: 'valid',
      routingStatus: 'valid',
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      verifiedAt: new Date('2026-04-23T10:00:00.000Z'),
    });
    expect(await readStoredCustomDomain()).toMatchObject({
      id: 'cdom_old',
      ownershipStatus: 'pending',
      routingStatus: 'pending',
    });

    await deleteCustomDomain({
      host: 'app.customer.example.com',
      id: 'cdom_recreated',
    });
    expect(await readStoredCustomDomain()).toMatchObject({
      id: 'cdom_old',
    });
  });
});

async function createQueryTestScope(): Promise<void> {
  await db.insert(principals).values({
    email: 'custom-domains@example.com',
    id: 'prn_custom_domains',
    type: 'user',
  });
  await db.insert(organizations).values({
    id: 'org_custom_domains',
    name: 'Custom Domains Org',
    slug: 'custom-domains-org',
  });
  await db.insert(projects).values({
    id: 'prj_custom_domains',
    name: 'billing',
    organizationId: 'org_custom_domains',
    updatedAt: new Date('2026-04-23T09:00:00.000Z'),
  });
  await db.insert(projectServices).values({
    id: 'svc_custom_domains',
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: 'prj_custom_domains',
    updatedAt: new Date('2026-04-23T09:00:00.000Z'),
  });
  await db.insert(environments).values({
    id: 'env_custom_domains',
    name: 'production',
    projectId: 'prj_custom_domains',
    updatedAt: new Date('2026-04-23T09:00:00.000Z'),
  });
}

async function insertCustomDomain(id: string): Promise<void> {
  await db.insert(deploymentCustomDomains).values({
    createdByPrincipalId: 'prn_custom_domains',
    environmentId: 'env_custom_domains',
    host: 'app.customer.example.com',
    id,
    ownershipStatus: 'pending',
    projectServiceId: 'svc_custom_domains',
    routingStatus: 'pending',
    updatedAt: new Date('2026-04-23T09:00:00.000Z'),
    verificationTokenHash: 'hash',
  });
}

async function readStoredCustomDomain(): Promise<typeof deploymentCustomDomains.$inferSelect | undefined> {
  const rows: (typeof deploymentCustomDomains.$inferSelect)[] = await db.select().from(deploymentCustomDomains);

  return rows[0];
}
