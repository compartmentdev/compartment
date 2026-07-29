import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizations, projectKubeProvisioning, projects } from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type {
  ProjectKubeProvisioningState,
  ProjectProvisioningClaimRow,
} from '../src/queries/project-provisioning.query.types';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import { claimPendingProjectProvisioning } from '../src/queries/project-provisioning.query';
import { readPodMetricNamespaceScope } from '../src/services/pod-metrics-namespace.service';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'pod_metric_namespaces');
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
  auditRetentionCleanupBatchSize: 1,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 1,
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  auditRetentionDays: 90,
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  tlsMode: 'internal',
  controlPlaneHost: 'compartment.localhost',
  databaseUrl,
  edgeToken: 'edge',
  edgeUrl: 'http://127.0.0.1:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 443,
  publicProtocol: 'http',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'runtime',
  sessionSecret: 'secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/sources',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/system.sock',
  systemToken: 'system',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};

describe('Pod metric namespace scope', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  it('returns only active provisioned projects in deterministic order', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_metrics', name: 'Metrics', slug: 'metrics' });
    await seedProject('prj_z', 'succeeded');
    await seedProject('prj_a', 'succeeded');
    await seedProject('prj_archived', 'succeeded', new Date('2026-07-21T04:00:00.000Z'));
    await seedProject('prj_pending', 'pending');
    await seedProject('prj_failed', 'failed');
    await seedProject('prj_teardown', 'teardown_pending');

    await expect(readPodMetricNamespaceScope()).resolves.toEqual({ namespaceIds: ['prj_a', 'prj_z'] });
  });

  it('reclaims pre-isolation succeeded projects and rejects stale-generation completion', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_upgrade', name: 'Upgrade', slug: 'upgrade' });
    await db.insert(projects).values({ id: 'prj_upgrade', name: 'upgrade', organizationId: 'org_upgrade' });
    await db
      .insert(projectKubeProvisioning)
      .values({ isolationVersion: 0, projectId: 'prj_upgrade', state: 'succeeded' });

    const target: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning('provision');
    expect(target).toMatchObject({ isolationVersion: 1, projectId: 'prj_upgrade' });
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: 0,
        leaseId: target?.leaseId ?? '',
        projectId: 'prj_upgrade',
        status: 'succeeded',
      }),
    ).resolves.toBe(false);
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: target?.isolationVersion ?? 1,
        leaseId: target?.leaseId ?? '',
        projectId: 'prj_upgrade',
        status: 'succeeded',
      }),
    ).resolves.toBe(true);

    await expect(claimPendingProjectProvisioning('provision')).resolves.toBeNull();
  });

  it('starts isolation-upgrade retry accounting in the new generation', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_retry', name: 'Retry', slug: 'retry' });
    await db.insert(projects).values({ id: 'prj_retry', name: 'retry', organizationId: 'org_retry' });
    await db
      .insert(projectKubeProvisioning)
      .values({ attempts: 3, isolationVersion: 0, projectId: 'prj_retry', state: 'succeeded' });

    const first: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning('provision');
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: 'retry upgrade',
        isolationVersion: first?.isolationVersion ?? 1,
        leaseId: first?.leaseId ?? '',
        projectId: 'prj_retry',
        status: 'failed',
      }),
    ).resolves.toBe(true);
    await db
      .update(projectKubeProvisioning)
      .set({ updatedAt: new Date(0) })
      .where(eq(projectKubeProvisioning.projectId, 'prj_retry'));

    await expect(claimPendingProjectProvisioning('provision')).resolves.toMatchObject({
      isolationVersion: 1,
      projectId: 'prj_retry',
    });
  });
});

async function seedProject(
  projectId: string,
  state: ProjectKubeProvisioningState,
  archivedAt: Date | null = null,
): Promise<void> {
  await db.insert(projects).values({ archivedAt, id: projectId, name: projectId, organizationId: 'org_metrics' });
  await db.insert(projectKubeProvisioning).values({ projectId, state });
}
