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
import { updateCustomDomainCheck } from '../src/queries/custom-domains.query';
import { beginCustomDomainDeletion, markCustomDomainDeletionReady } from '../src/queries/custom-domain-deletion.query';
import {
  activateCustomDomainReconcileRow,
  claimCustomDomainReconcileRow,
  enableCustomDomainEdgeRouting,
  observeCustomDomainReconcileRow,
  settleDeletedCustomDomain,
} from '../src/queries/custom-domain-reconcile.query';
import type {
  ClaimedCustomDomainReconcileRow,
  CustomDomainDeletionTransition,
} from '../src/queries/custom-domain-reconcile.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { isUniqueConstraintError } from '../src/queries/query-error';

const { testDatabaseUrl } = readDatabaseTestMode();
const customDomainsQueryDatabaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'custom_domains_query');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
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
      desiredGeneration: 2,
      failureMessage: null,
      host: 'app.customer.example.com',
      id: 'cdom_recreated',
      lastCheckedAt: new Date('2026-04-23T10:00:00.000Z'),
      organizationId: 'org_custom_domains',
      ownershipStatus: 'valid',
      reconcileState: 'reconciling',
      routingStatus: 'valid',
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      verifiedAt: new Date('2026-04-23T10:00:00.000Z'),
    });
    expect(await readStoredCustomDomain()).toMatchObject({
      id: 'cdom_old',
      ownershipStatus: 'pending',
      routingStatus: 'pending',
    });

    await expect(beginCustomDomainDeletion('cdom_recreated')).resolves.toBeNull();
    expect(await readStoredCustomDomain()).toMatchObject({
      id: 'cdom_old',
    });
  });

  it('claims once, releases an incomplete observation without livelock, and activates only a ready generation', async (): Promise<void> => {
    await createQueryTestScope();
    await insertCustomDomain('cdom_reconcile', 'reconciling');

    const first: ClaimedCustomDomainReconcileRow | null = await claimCustomDomainReconcileRow();
    expect(first).toMatchObject({ domainId: 'cdom_reconcile', operation: 'reconcile' });
    expect(await claimCustomDomainReconcileRow()).toBeNull();

    await observeCustomDomainReconcileRow({
      certificatePresent: true,
      certificateReady: false,
      ingressPresent: true,
      leaseId: first!.leaseId,
      observedGeneration: 1,
      releaseLease: true,
    });
    expect(await activateCustomDomainReconcileRow(first!.leaseId, 1)).toBe(false);

    expect(await claimCustomDomainReconcileRow()).toBeNull();
    await expireCustomDomainLease();
    const retry: ClaimedCustomDomainReconcileRow | null = await claimCustomDomainReconcileRow();
    expect(retry).not.toBeNull();
    await observeCustomDomainReconcileRow({
      certificatePresent: true,
      certificateReady: true,
      ingressPresent: true,
      leaseId: retry!.leaseId,
      observedGeneration: 1,
      releaseLease: false,
    });
    expect(await enableCustomDomainEdgeRouting(retry!.leaseId, 1)).toBe(true);
    expect(await activateCustomDomainReconcileRow(retry!.leaseId, 1)).toBe(true);
    expect(await readStoredCustomDomain()).toMatchObject({
      edgeRoutingEnabled: true,
      observedGeneration: 1,
      reconcileState: 'active',
    });
  });

  it('does not settle deletion until exact reads confirm both resources absent', async (): Promise<void> => {
    await createQueryTestScope();
    await insertCustomDomain('cdom_delete', 'deleting', true);
    const claim: ClaimedCustomDomainReconcileRow | null = await claimCustomDomainReconcileRow();

    await observeCustomDomainReconcileRow({
      certificatePresent: false,
      certificateReady: false,
      ingressPresent: true,
      leaseId: claim!.leaseId,
      observedGeneration: 1,
      releaseLease: true,
    });
    expect(await settleDeletedCustomDomain(claim!.leaseId, 1)).toBe(false);
    expect(await readStoredCustomDomain()).toBeDefined();

    expect(await claimCustomDomainReconcileRow()).toBeNull();
    await expireCustomDomainLease();
    const retry: ClaimedCustomDomainReconcileRow | null = await claimCustomDomainReconcileRow();
    await observeCustomDomainReconcileRow({
      certificatePresent: false,
      certificateReady: false,
      ingressPresent: false,
      leaseId: retry!.leaseId,
      observedGeneration: 1,
      releaseLease: false,
    });
    expect(await settleDeletedCustomDomain(retry!.leaseId, 1)).toBe(true);
    expect(await readStoredCustomDomain()).toBeUndefined();
  });

  it('does not expose deletion work until durable Edge shutdown is acknowledged', async (): Promise<void> => {
    await createQueryTestScope();
    await insertCustomDomain('cdom_edge_gate', 'pending');

    const transition: CustomDomainDeletionTransition | null = await beginCustomDomainDeletion('cdom_edge_gate');

    expect(transition).toMatchObject({ deletionGeneration: 2, previousState: 'pending' });
    expect(await claimCustomDomainReconcileRow()).toBeNull();
    expect(await markCustomDomainDeletionReady('cdom_edge_gate', 2)).toBe(true);
    expect(await claimCustomDomainReconcileRow()).toMatchObject({
      desiredGeneration: 2,
      operation: 'delete',
    });
  });

  it('enforces global hostname uniqueness at the database boundary', async (): Promise<void> => {
    await createQueryTestScope();
    await insertCustomDomain('cdom_first');

    let collision: Error | null = null;
    try {
      await insertCustomDomain('cdom_second');
    } catch (error) {
      collision = error as Error;
    }
    expect(isUniqueConstraintError(collision ?? undefined)).toBe(true);
  });

  it('fails closed when another organization targets a known domain row', async (): Promise<void> => {
    await createQueryTestScope();
    await db.insert(organizations).values({
      id: 'org_other',
      name: 'Other Org',
      slug: 'other-org',
    });
    await insertCustomDomain('cdom_owned');

    await updateCustomDomainCheck({
      desiredGeneration: 2,
      failureMessage: null,
      host: 'app.customer.example.com',
      id: 'cdom_owned',
      lastCheckedAt: new Date('2026-04-23T10:00:00.000Z'),
      organizationId: 'org_other',
      ownershipStatus: 'valid',
      reconcileState: 'reconciling',
      routingStatus: 'valid',
      updatedAt: new Date('2026-04-23T10:00:00.000Z'),
      verifiedAt: new Date('2026-04-23T10:00:00.000Z'),
    });

    expect(await readStoredCustomDomain()).toMatchObject({
      ownershipStatus: 'pending',
      routingStatus: 'pending',
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

async function insertCustomDomain(
  id: string,
  reconcileState: 'deleting' | 'pending' | 'reconciling' = 'pending',
  deletionReady: boolean = false,
): Promise<void> {
  await db.insert(deploymentCustomDomains).values({
    createdByPrincipalId: 'prn_custom_domains',
    deletionReady,
    environmentId: 'env_custom_domains',
    host: 'app.customer.example.com',
    id,
    ownershipStatus: 'pending',
    reconcileState,
    projectServiceId: 'svc_custom_domains',
    routingStatus: 'pending',
    updatedAt: new Date('2026-04-23T09:00:00.000Z'),
    verificationTokenHash: 'hash',
  });
}

async function expireCustomDomainLease(): Promise<void> {
  await db.update(deploymentCustomDomains).set({ reconcileLeaseExpiresAt: new Date('2000-01-01T00:00:00.000Z') });
}

async function readStoredCustomDomain(): Promise<typeof deploymentCustomDomains.$inferSelect | undefined> {
  const rows: (typeof deploymentCustomDomains.$inferSelect)[] = await db.select().from(deploymentCustomDomains);

  return rows[0];
}
