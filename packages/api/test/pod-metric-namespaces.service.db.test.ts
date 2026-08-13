import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import { organizationQuotaReconciliation, organizations, projectKubeProvisioning, projects } from '../src/db/schema';
import type {
  ProjectKubeProvisioningState,
  ProjectProvisioningClaimRow,
} from '../src/queries/project-provisioning.query.types';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import { claimPendingProjectProvisioning } from '../src/queries/project-provisioning.query';
import { projectIsolationVersion } from '../src/queries/project-provisioning-policy';
import { readPodMetricNamespaceScope } from '../src/services/pod-metrics-namespace.service';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'pod_metric_namespaces');
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const apiConfig: ApiConfig = createApiTestConfig({
  auditRetentionCleanupBatchSize: 1,
  auditRetentionCleanupMaxBatches: 1,
  databaseUrl,
});

describe('Pod metric namespace scope', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  it('returns only active provisioned projects in deterministic order', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_metrics', name: 'Metrics', slug: 'metrics' });
    await seedOrganizationQuota('org_metrics');
    await seedProject('prj_z', 'succeeded');
    await seedProject('prj_a', 'succeeded');
    await seedProject('prj_archived', 'succeeded', new Date('2026-07-21T04:00:00.000Z'));
    await seedProject('prj_pending', 'pending');
    await seedProject('prj_failed', 'failed');
    await seedProject('prj_teardown', 'teardown_pending');

    await expect(readPodMetricNamespaceScope()).resolves.toEqual({ namespaceIds: ['prj_a', 'prj_z'] });
  });

  it('reclaims projects on the tenant-capacity policy revision and rejects stale completion', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_upgrade', name: 'Upgrade', slug: 'upgrade' });
    await seedOrganizationQuota('org_upgrade');
    await db.insert(projects).values({
      defaultAccessMode: 'authenticated',
      id: 'prj_upgrade',
      name: 'upgrade',
      organizationId: 'org_upgrade',
    });
    await db
      .insert(projectKubeProvisioning)
      .values({ isolationVersion: projectIsolationVersion - 1, projectId: 'prj_upgrade', state: 'succeeded' });

    const target: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning('provision');
    assert(target !== null);
    expect(target).toMatchObject({ isolationVersion: projectIsolationVersion, projectId: 'prj_upgrade' });
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: projectIsolationVersion - 1,
        leaseId: target.leaseId,
        projectId: 'prj_upgrade',
        status: 'succeeded',
      }),
    ).resolves.toBe(false);
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: target.isolationVersion,
        leaseId: target.leaseId,
        projectId: 'prj_upgrade',
        status: 'succeeded',
      }),
    ).resolves.toBe(true);

    await expect(claimPendingProjectProvisioning('provision')).resolves.toBeNull();
  });

  it('starts isolation-upgrade retry accounting in the new generation', async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_retry', name: 'Retry', slug: 'retry' });
    await seedOrganizationQuota('org_retry');
    await db
      .insert(projects)
      .values({ defaultAccessMode: 'authenticated', id: 'prj_retry', name: 'retry', organizationId: 'org_retry' });
    await db.insert(projectKubeProvisioning).values({
      attempts: 3,
      isolationVersion: projectIsolationVersion - 1,
      projectId: 'prj_retry',
      state: 'succeeded',
    });

    const first: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning('provision');
    assert(first !== null);
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: 'retry upgrade',
        isolationVersion: first.isolationVersion,
        leaseId: first.leaseId,
        projectId: 'prj_retry',
        status: 'failed',
      }),
    ).resolves.toBe(true);
    await db
      .update(projectKubeProvisioning)
      .set({ updatedAt: new Date(0) })
      .where(eq(projectKubeProvisioning.projectId, 'prj_retry'));

    await expect(claimPendingProjectProvisioning('provision')).resolves.toMatchObject({
      isolationVersion: projectIsolationVersion,
      projectId: 'prj_retry',
    });
  });
});

async function seedOrganizationQuota(organizationId: string): Promise<void> {
  await db.insert(organizationQuotaReconciliation).values({ organizationId, state: 'succeeded' });
}

async function seedProject(
  projectId: string,
  state: ProjectKubeProvisioningState,
  archivedAt: Date | null = null,
): Promise<void> {
  await db.insert(projects).values({
    archivedAt,
    defaultAccessMode: 'authenticated',
    id: projectId,
    name: projectId,
    organizationId: 'org_metrics',
  });
  await db.insert(projectKubeProvisioning).values({ isolationVersion: projectIsolationVersion, projectId, state });
}
