import type { ExistingProjectRemoteState } from '@compartment/contracts';
import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  organizationMemberships,
  organizations,
  principals,
  productJobRuns,
  projectKubeProvisioning,
  projects,
  sourceBindings,
  sourceExcludedDescriptors,
  sourceEvents,
  sourceResolutionTasks,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { claimProductJob } from '../src/queries/product-job-runs.query';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import {
  claimPendingProjectProvisioning,
  failExhaustedProjectTeardownLeases,
} from '../src/queries/project-provisioning.query';
import {
  activateProjectTeardownWithTransaction,
  prepareProjectTeardownWithTransaction,
  releaseProjectTeardownPreparation,
  renewProjectTeardownPreparation,
} from '../src/queries/project-teardown.query';
import type {
  ProjectProvisioningClaimRow,
  ProjectTeardownPreparationResult,
} from '../src/queries/project-provisioning.query.types';
import type { ProjectsMutationTransaction } from '../src/queries/projects.query.types';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import type { resolveActiveProjectScope, resolveRequiredProjectScope } from '../src/services/project-scope.service';
import {
  archiveProjectForPrincipal,
  deleteProjectForPrincipal,
  getActiveProjectForPrincipal,
  renameProjectForPrincipal,
  unarchiveProjectForPrincipal,
} from '../src/services/projects.service';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../src/services/rbac-seed.service';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

type ResolveActiveProjectScope = typeof resolveActiveProjectScope;
type ResolveRequiredProjectScope = typeof resolveRequiredProjectScope;

interface ProjectScopeServiceModule {
  resolveActiveProjectScope: Mock<ResolveActiveProjectScope>;
  resolveRequiredProjectScope: Mock<ResolveRequiredProjectScope>;
}

interface ProjectScopeMocks {
  resolveActiveProjectScope: Mock<ResolveActiveProjectScope>;
  resolveRequiredProjectScope: Mock<ResolveRequiredProjectScope>;
}

const mocks: ProjectScopeMocks = vi.hoisted(
  (): ProjectScopeMocks => ({
    resolveActiveProjectScope: vi.fn<ResolveActiveProjectScope>(),
    resolveRequiredProjectScope: vi.fn<ResolveRequiredProjectScope>(),
  }),
);

vi.mock(
  '../src/services/project-scope.service',
  (): ProjectScopeServiceModule => ({
    resolveActiveProjectScope: mocks.resolveActiveProjectScope,
    resolveRequiredProjectScope: mocks.resolveRequiredProjectScope,
  }),
);

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'projects_service_db');
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
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('projects service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await seedDeleteScope();
      mocks.resolveActiveProjectScope.mockReset();
      mocks.resolveRequiredProjectScope.mockResolvedValue(createResolvedProjectScope());
    },
  });

  it('blocks renaming projects while an active git binding exists', async (): Promise<void> => {
    mocks.resolveActiveProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: null,
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    await expect(
      renameProjectForPrincipal({
        nextProjectName: 'ops-renamed',
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'ops',
      }),
    ).rejects.toMatchObject({ code: 'project_git_source_bound' });

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_ops'))).toMatchObject([
      {
        name: 'ops',
      },
    ]);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        descriptorDirectory: 'apps/ops',
        descriptorPath: 'apps/ops/compartment.yml',
        projectId: 'prj_ops',
        projectName: 'ops',
        status: 'active',
      },
    ]);
  });

  it('reprojects a renamed project through its immutable Kubernetes namespace identity', async (): Promise<void> => {
    mocks.resolveActiveProjectScope.mockResolvedValue(
      createResolvedProjectScope({ projectId: 'prj_plain', projectName: 'plain' }),
    );

    await expect(
      renameProjectForPrincipal({
        nextProjectName: 'plain-renamed',
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'plain',
      }),
    ).resolves.toMatchObject({ id: 'prj_plain', name: 'plain-renamed' });

    await expect(claimPendingProjectProvisioning('provision')).resolves.toMatchObject({
      action: 'provision',
      projectId: 'prj_plain',
      projectName: 'plain-renamed',
    });
  });

  it('reprojects a rename that races with active Kubernetes provisioning', async (): Promise<void> => {
    await db
      .update(projectKubeProvisioning)
      .set({ isolationVersion: 0 })
      .where(eq(projectKubeProvisioning.projectId, 'prj_plain'));
    const originalClaim: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning('provision');
    if (originalClaim === null) {
      throw new Error('Expected the original project provisioning claim.');
    }
    mocks.resolveActiveProjectScope.mockResolvedValue(
      createResolvedProjectScope({ projectId: 'prj_plain', projectName: 'plain' }),
    );

    await renameProjectForPrincipal({
      nextProjectName: 'plain-renamed',
      organizationSlug: 'acme-dev',
      principalId: 'prn_git_sources',
      projectName: 'plain',
    });
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: originalClaim.isolationVersion,
        leaseId: originalClaim.leaseId,
        projectId: originalClaim.projectId,
        status: 'running',
      }),
    ).resolves.toBe(true);
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: originalClaim.isolationVersion,
        leaseId: originalClaim.leaseId,
        projectId: originalClaim.projectId,
        status: 'succeeded',
      }),
    ).resolves.toBe(true);

    await expect(claimPendingProjectProvisioning('provision')).resolves.toMatchObject({
      action: 'provision',
      projectId: 'prj_plain',
      projectName: 'plain-renamed',
    });
  });

  it('fails closed when an authorized organization context targets another organization project id', async (): Promise<void> => {
    mocks.resolveActiveProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: null,
        organizationId: 'org_other',
        projectId: 'prj_billing',
        projectName: 'billing',
      }),
    );

    await expect(
      renameProjectForPrincipal({
        nextProjectName: 'cross-org-rename',
        organizationSlug: 'other',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).rejects.toThrow('Project mutation failed.');
    expect(await db.select().from(projects).where(eq(projects.id, 'prj_billing'))).toMatchObject([
      { name: 'billing', organizationId: 'org_git_sources' },
    ]);
  });

  it('deletes archived projects after disconnecting their git source', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({ projectName: 'billing', recoveredTerminalFailureMessage: null });
    await expect(claimPendingProjectProvisioning('provision')).resolves.toBeNull();
    const teardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
    expect(teardown).toMatchObject({ action: 'teardown', projectId: 'prj_billing' });
    expect(await db.select().from(projects).where(eq(projects.id, 'prj_billing'))).toHaveLength(1);
    await completeProjectProvisioning({
      action: 'teardown',
      failureMessage: null,
      isolationVersion: teardown.isolationVersion,
      leaseId: teardown.leaseId,
      projectId: teardown.projectId,
      status: 'succeeded',
    });

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_billing'))).toHaveLength(0);
    expect(
      await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_billing_disconnected')),
    ).toMatchObject([
      {
        projectId: null,
        status: 'disconnected',
      },
    ]);
  });

  it('caps failed project teardown until an explicit delete requeues it', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({ projectName: 'billing', recoveredTerminalFailureMessage: null });

    for (let attempt: number = 1; attempt <= 3; attempt += 1) {
      const teardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
      await completeProjectProvisioning({
        action: 'teardown',
        failureMessage: 'namespace deletion stopped making progress',
        isolationVersion: teardown.isolationVersion,
        leaseId: teardown.leaseId,
        projectId: teardown.projectId,
        status: 'failed',
      });
      await db
        .update(projectKubeProvisioning)
        .set({ updatedAt: new Date('2020-01-01T00:00:00.000Z') })
        .where(eq(projectKubeProvisioning.projectId, teardown.projectId));
    }

    await expect(claimPendingProjectProvisioning('teardown')).resolves.toBeNull();
    await expect(
      db
        .select({
          attempts: projectKubeProvisioning.attempts,
          failureMessage: projectKubeProvisioning.failureMessage,
          state: projectKubeProvisioning.state,
        })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([
      {
        attempts: 3,
        failureMessage:
          'Project Kubernetes teardown failed after 3 attempts: namespace deletion stopped making progress',
        state: 'teardown_failed',
      },
    ]);
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({
      projectName: 'billing',
      recoveredTerminalFailureMessage:
        'Project Kubernetes teardown failed after 3 attempts: namespace deletion stopped making progress',
    });
    const retriedTeardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
    expect(retriedTeardown).toMatchObject({ action: 'teardown', projectId: 'prj_billing' });
    await expect(
      db
        .select({ attempts: projectKubeProvisioning.attempts, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([{ attempts: 1, state: 'teardown_running' }]);
  });

  it('terminally fails an expired final teardown lease', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({ projectName: 'billing', recoveredTerminalFailureMessage: null });
    await db
      .update(projectKubeProvisioning)
      .set({
        attempts: 3,
        leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'),
        leaseId: 'kpl_expired',
        state: 'teardown_running',
      })
      .where(eq(projectKubeProvisioning.projectId, 'prj_billing'));

    await expect(failExhaustedProjectTeardownLeases()).resolves.toEqual(['prj_billing']);
    await expect(claimPendingProjectProvisioning('teardown')).resolves.toBeNull();
    await expect(
      db
        .select({ failureMessage: projectKubeProvisioning.failureMessage, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([
      {
        failureMessage: 'Project Kubernetes teardown failed after 3 attempts: The final teardown lease expired.',
        state: 'teardown_failed',
      },
    ]);
  });

  it('does not consume teardown attempts when expired running leases are reclaimed', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({ projectName: 'billing', recoveredTerminalFailureMessage: null });

    for (let reclaim: number = 0; reclaim < 3; reclaim += 1) {
      const teardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
      await db
        .update(projectKubeProvisioning)
        .set({ leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z'), leaseId: teardown.leaseId })
        .where(eq(projectKubeProvisioning.projectId, teardown.projectId));
    }

    const reclaimed: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
    await expect(failExhaustedProjectTeardownLeases()).resolves.toEqual([]);
    await expect(
      db
        .select({ attempts: projectKubeProvisioning.attempts, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, reclaimed.projectId)),
    ).resolves.toEqual([{ attempts: 1, state: 'teardown_running' }]);
  });

  it('blocks unarchiving while project deletion is pending', async (): Promise<void> => {
    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).resolves.toMatchObject({ projectName: 'billing', recoveredTerminalFailureMessage: null });

    await expect(
      unarchiveProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).rejects.toMatchObject({ code: 'project_lifecycle_not_available' });
    await expect(
      db.select({ archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, 'prj_billing')),
    ).resolves.toEqual([{ archivedAt: new Date('2026-04-28T12:00:00.000Z') }]);
  });

  it('keeps project teardown preparation durable and unclaimable', async (): Promise<void> => {
    const preparation: ProjectTeardownPreparationResult = await db.transaction(
      async (transaction: ProjectsMutationTransaction): Promise<ProjectTeardownPreparationResult> =>
        await prepareProjectTeardownWithTransaction(transaction, 'prj_billing'),
    );
    expect(preparation.preparationLeaseId).toEqual(expect.any(String));
    await db.transaction(async (transaction: ProjectsMutationTransaction): Promise<void> => {
      await expect(prepareProjectTeardownWithTransaction(transaction, 'prj_billing')).resolves.toEqual({
        preparationLeaseId: null,
        recoveredTerminalFailureMessage: null,
      });
    });

    await expect(claimPendingProjectProvisioning('teardown')).resolves.toBeNull();
    await expect(
      unarchiveProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'billing',
      }),
    ).rejects.toMatchObject({ code: 'project_lifecycle_not_available' });
    await expect(
      db
        .select({ attempts: projectKubeProvisioning.attempts, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([{ attempts: 0, state: 'teardown_preparing' }]);
  });

  it('preserves the terminal teardown reason until recovery activation succeeds', async (): Promise<void> => {
    const terminalFailure: string =
      'Project Kubernetes teardown failed after 3 attempts: namespace deletion stopped making progress';
    await db
      .update(projectKubeProvisioning)
      .set({ attempts: 3, failureMessage: terminalFailure, state: 'teardown_failed' })
      .where(eq(projectKubeProvisioning.projectId, 'prj_billing'));

    const firstPreparation: ProjectTeardownPreparationResult = await db.transaction(
      async (transaction: ProjectsMutationTransaction): Promise<ProjectTeardownPreparationResult> =>
        await prepareProjectTeardownWithTransaction(transaction, 'prj_billing'),
    );
    const firstLeaseId: string | null = firstPreparation.preparationLeaseId;
    expect(firstLeaseId).toEqual(expect.any(String));
    expect(firstPreparation.recoveredTerminalFailureMessage).toBe(terminalFailure);
    if (firstLeaseId === null) {
      throw new Error('Expected the recovery preparation lease.');
    }
    await releaseProjectTeardownPreparation('prj_billing', firstLeaseId);
    const recoveryPreparation: ProjectTeardownPreparationResult = await db.transaction(
      async (transaction: ProjectsMutationTransaction): Promise<ProjectTeardownPreparationResult> =>
        await prepareProjectTeardownWithTransaction(transaction, 'prj_billing'),
    );
    const recoveryLeaseId: string | null = recoveryPreparation.preparationLeaseId;
    expect(recoveryLeaseId).toEqual(expect.any(String));
    expect(recoveryPreparation.recoveredTerminalFailureMessage).toBe(terminalFailure);

    await expect(
      db
        .select({ failureMessage: projectKubeProvisioning.failureMessage, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([{ failureMessage: terminalFailure, state: 'teardown_preparing' }]);

    if (recoveryLeaseId === null) {
      throw new Error('Expected the renewed recovery preparation lease.');
    }
    await db.transaction(async (transaction: ProjectsMutationTransaction): Promise<void> => {
      await activateProjectTeardownWithTransaction(transaction, 'prj_billing', recoveryLeaseId);
    });
    await expect(
      db
        .select({ failureMessage: projectKubeProvisioning.failureMessage, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([{ failureMessage: null, state: 'teardown_pending' }]);
  });

  it('fences stale project teardown preparation owners', async (): Promise<void> => {
    const firstPreparation: ProjectTeardownPreparationResult = await db.transaction(
      async (transaction: ProjectsMutationTransaction): Promise<ProjectTeardownPreparationResult> =>
        await prepareProjectTeardownWithTransaction(transaction, 'prj_billing'),
    );
    const firstLeaseId: string | null = firstPreparation.preparationLeaseId;
    expect(firstLeaseId).toEqual(expect.any(String));
    if (firstLeaseId === null) {
      throw new Error('Expected the first project teardown preparation lease.');
    }
    await expect(renewProjectTeardownPreparation('prj_billing', firstLeaseId)).resolves.toBe(true);
    await db
      .update(projectKubeProvisioning)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(projectKubeProvisioning.projectId, 'prj_billing'));

    const nextPreparation: ProjectTeardownPreparationResult = await db.transaction(
      async (transaction: ProjectsMutationTransaction): Promise<ProjectTeardownPreparationResult> =>
        await prepareProjectTeardownWithTransaction(transaction, 'prj_billing'),
    );
    const nextLeaseId: string | null = nextPreparation.preparationLeaseId;
    expect(nextLeaseId).toEqual(expect.any(String));
    expect(nextLeaseId).not.toBe(firstLeaseId);
    if (nextLeaseId === null) {
      throw new Error('Expected the replacement project teardown preparation lease.');
    }

    await expect(
      db.transaction(async (transaction: ProjectsMutationTransaction): Promise<void> => {
        await activateProjectTeardownWithTransaction(transaction, 'prj_billing', firstLeaseId);
      }),
    ).rejects.toThrow('Project Kubernetes teardown is not ready to activate.');
    await releaseProjectTeardownPreparation('prj_billing', firstLeaseId);
    await expect(renewProjectTeardownPreparation('prj_billing', firstLeaseId)).resolves.toBe(false);
    await expect(renewProjectTeardownPreparation('prj_billing', nextLeaseId)).resolves.toBe(true);
    await expect(
      db
        .select({ leaseId: projectKubeProvisioning.leaseId, state: projectKubeProvisioning.state })
        .from(projectKubeProvisioning)
        .where(eq(projectKubeProvisioning.projectId, 'prj_billing')),
    ).resolves.toEqual([{ leaseId: nextLeaseId, state: 'teardown_preparing' }]);
  });

  it('blocks deleting archived projects while an active git binding exists', async (): Promise<void> => {
    await db
      .update(projects)
      .set({
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        updatedAt: new Date('2026-04-28T12:10:00.000Z'),
      })
      .where(eq(projects.id, 'prj_ops'));
    mocks.resolveRequiredProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    await expect(
      deleteProjectForPrincipal({
        organizationSlug: 'acme-dev',
        principalId: 'prn_git_sources',
        projectName: 'ops',
      }),
    ).rejects.toMatchObject({ code: 'project_git_source_bound' });

    expect(await db.select().from(projects).where(eq(projects.id, 'prj_ops'))).toMatchObject([
      {
        archivedAt: new Date('2026-04-28T12:10:00.000Z'),
        name: 'ops',
      },
    ]);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        descriptorDirectory: 'apps/ops',
        descriptorPath: 'apps/ops/compartment.yml',
        projectId: 'prj_ops',
        projectName: 'ops',
        status: 'active',
      },
    ]);
  });

  it('archives git-bound projects by disconnecting the binding and creating an exclusion', async (): Promise<void> => {
    mocks.resolveRequiredProjectScope.mockResolvedValue(
      createResolvedProjectScope({
        archivedAt: null,
        projectId: 'prj_ops',
        projectName: 'ops',
      }),
    );

    const archivedProject: {
      archivedAt: Date | null;
      createdAt: Date;
      id: string;
      name: string;
      organizationId: string;
      updatedAt: Date;
    } = await archiveProjectForPrincipal({
      organizationSlug: 'acme-dev',
      principalId: 'prn_git_sources',
      projectName: 'ops',
    });

    expect(archivedProject.id).toBe('prj_ops');
    expect(archivedProject.archivedAt).toBeInstanceOf(Date);
    const storedProject: (typeof projects.$inferSelect)[] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, 'prj_ops'));
    expect(storedProject[0]?.archivedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sourceBindings).where(eq(sourceBindings.id, 'sbd_ops_active'))).toMatchObject([
      {
        status: 'disconnected',
      },
    ]);
    expect(
      await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, 'src_ops_active')),
    ).toMatchObject([
      {
        descriptorPath: 'apps/ops/compartment.yml',
      },
    ]);
    expect(
      await db.select().from(sourceResolutionTasks).where(eq(sourceResolutionTasks.sourceBindingId, 'sbd_ops_active')),
    ).toMatchObject([
      {
        failureReason: 'Git source binding was excluded from source sync.',
        status: 'canceled',
      },
    ]);
  });

  it('durably cancels queued release Jobs in the archive transaction', async (): Promise<void> => {
    mocks.resolveRequiredProjectScope.mockResolvedValue(
      createResolvedProjectScope({ archivedAt: null, projectId: 'prj_plain', projectName: 'plain' }),
    );
    await db.insert(productJobRuns).values({
      commandJson: '["bin/release"]',
      envJson: '{}',
      id: 'job_archived_release',
      identityId: 'dep_archived_release',
      image: 'registry.example/release@sha256:abc',
      imagePullSecretId: 'pull-project',
      jobClass: 'release',
      namespace: 'cpt-prj-plain',
      projectId: 'prj_plain',
      status: 'queued',
      timeoutMs: 30_000,
    });

    await archiveProjectForPrincipal({
      organizationSlug: 'acme-dev',
      principalId: 'prn_git_sources',
      projectName: 'plain',
    });

    await expect(db.select().from(productJobRuns)).resolves.toMatchObject([
      { finalizedAt: null, projectId: 'prj_plain', status: 'timed-out' },
    ]);
    await db.delete(projects).where(eq(projects.id, 'prj_plain'));
    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_archived_release' },
      persistedResult: { status: 'timed-out' },
    });
  });

  it.each([
    ['active', 'prj_ops', 'ops'],
    ['disconnected', 'prj_billing', 'billing'],
    ['active', 'prj_plain', 'plain'],
  ] satisfies [ExistingProjectRemoteState, string, string][])(
    'reads %s remote state for project show',
    async (expectedRemoteState: ExistingProjectRemoteState, projectId: string, projectName: string): Promise<void> => {
      mocks.resolveActiveProjectScope.mockResolvedValue(
        createResolvedProjectScope({
          archivedAt: null,
          projectId,
          projectName,
        }),
      );

      await expect(
        getActiveProjectForPrincipal({
          organizationSlug: 'acme-dev',
          principalId: 'prn_git_sources',
          projectName,
        }),
      ).resolves.toMatchObject({
        project: {
          id: projectId,
          name: projectName,
        },
        remoteState: expectedRemoteState,
      });
    },
  );
});

async function seedDeleteScope(): Promise<void> {
  await db.insert(principals).values({
    email: 'git-sources@example.com',
    id: 'prn_git_sources',
    type: 'user',
  });
  await db.insert(organizations).values({
    id: 'org_git_sources',
    name: 'Git Sources Org',
    slug: 'acme-dev',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_git_sources',
    organizationId: 'org_git_sources',
    principalId: 'prn_git_sources',
  });
  await db.transaction(async (transaction: RbacTransaction): Promise<void> => {
    await assignOrganizationSystemRoleToPrincipalWithExecutor(
      transaction,
      'org_git_sources',
      'prn_git_sources',
      'admin',
    );
  });
  await db.insert(projects).values({
    archivedAt: new Date('2026-04-28T12:00:00.000Z'),
    id: 'prj_billing',
    name: 'billing',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(projectKubeProvisioning).values({ projectId: 'prj_billing', state: 'succeeded' });
  await db.insert(projects).values({
    archivedAt: null,
    id: 'prj_ops',
    name: 'ops',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(projectKubeProvisioning).values({ projectId: 'prj_ops', state: 'succeeded' });
  await db.insert(projects).values({
    archivedAt: null,
    id: 'prj_plain',
    name: 'plain',
    organizationId: 'org_git_sources',
    updatedAt: new Date('2026-04-28T12:00:00.000Z'),
  });
  await db.insert(projectKubeProvisioning).values({ projectId: 'prj_plain', state: 'succeeded' });
  await db.insert(gitProviderRegistrations).values({
    appId: 'app_123',
    appName: 'Compartment GitHub App',
    appSlug: 'compartment-github-app',
    appUrl: 'https://github.com/apps/compartment-github-app',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdByPrincipalId: 'prn_git_sources',
    id: 'gpr_git_sources',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookUrl:
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_sources/registrations/gpr_git_sources/webhook',
  });
  await db.insert(sources).values({
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_git_sources',
    defaultAutoDeployEnabled: false,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    disconnectedAt: new Date('2026-04-28T12:05:00.000Z'),
    displayName: 'acme/mono',
    id: 'src_billing_disconnected',
    organizationId: 'org_git_sources',
    providerHost: 'github.com',
    providerInstallationId: 'inst_123',
    providerRegistrationId: 'gpr_git_sources',
    repositoryCloneUrl: 'https://github.com/acme/mono.git',
    repositoryExternalId: 'repo_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    status: 'disconnected',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceBindings).values({
    autoDeployEnabled: false,
    createdByPrincipalId: 'prn_git_sources',
    descriptorDirectory: '.',
    descriptorPath: 'compartment.yml',
    disconnectedAt: new Date('2026-04-28T12:05:00.000Z'),
    id: 'sbd_billing_disconnected',
    projectId: 'prj_billing',
    projectName: 'billing',
    sourceId: 'src_billing_disconnected',
    status: 'disconnected',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sources).values({
    autoAdoptNewApps: true,
    createdByPrincipalId: 'prn_git_sources',
    defaultAutoDeployEnabled: true,
    defaultBranchName: 'main',
    defaultEnvironmentName: 'production',
    disconnectedAt: null,
    displayName: 'acme/ops',
    id: 'src_ops_active',
    organizationId: 'org_git_sources',
    providerHost: 'github.com',
    providerInstallationId: 'inst_456',
    providerRegistrationId: 'gpr_git_sources',
    repositoryCloneUrl: 'https://github.com/acme/ops.git',
    repositoryExternalId: 'repo_456',
    repositoryName: 'ops',
    repositoryOwner: 'acme',
    status: 'active',
    syncBranchName: 'main',
    type: 'git',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceBindings).values({
    autoDeployEnabled: true,
    createdByPrincipalId: 'prn_git_sources',
    descriptorDirectory: 'apps/ops',
    descriptorPath: 'apps/ops/compartment.yml',
    disconnectedAt: null,
    id: 'sbd_ops_active',
    projectId: 'prj_ops',
    projectName: 'ops',
    sourceId: 'src_ops_active',
    status: 'active',
    updatedAt: new Date('2026-04-28T12:05:00.000Z'),
  });
  await db.insert(sourceEvents).values({
    branchName: 'main',
    changedFilesComplete: true,
    changedFilesJson: '[]',
    commitSha: 'sha_ops_pending',
    eventType: 'push',
    id: 'sev_ops_pending',
    payloadJson: '{}',
    providerDeliveryId: 'delivery_ops_pending',
    sourceId: 'src_ops_active',
    status: 'tasks_created',
    updatedAt: new Date('2026-04-28T12:06:00.000Z'),
  });
  await db.insert(sourceResolutionTasks).values({
    branchName: 'main',
    commitSha: 'sha_ops_pending',
    id: 'srt_ops_pending',
    maxAttempts: 5,
    sourceBindingId: 'sbd_ops_active',
    sourceEventId: 'sev_ops_pending',
    sourceId: 'src_ops_active',
    status: 'pending',
    targetEnvironmentName: 'production',
    updatedAt: new Date('2026-04-28T12:06:00.000Z'),
  });
}

function createResolvedProjectScope(
  options: {
    archivedAt?: Date | null;
    organizationId?: string;
    projectId?: string;
    projectName?: string;
  } = {},
): {
  access: { role: 'admin'; scopeId: string; scopeType: 'organization' };
  organization: { id: string; name: string; slug: string };
  project: {
    archivedAt: Date | null;
    createdAt: Date;
    id: string;
    name: string;
    organizationId: string;
    updatedAt: Date;
  };
} {
  return {
    access: {
      role: 'admin' as const,
      scopeId: 'org_git_sources',
      scopeType: 'organization' as const,
    },
    organization: {
      id: options.organizationId ?? 'org_git_sources',
      name: 'Git Sources Org',
      slug: 'acme-dev',
    },
    project: {
      archivedAt: options.archivedAt ?? new Date('2026-04-28T12:00:00.000Z'),
      createdAt: new Date('2026-04-28T11:00:00.000Z'),
      id: options.projectId ?? 'prj_billing',
      name: options.projectName ?? 'billing',
      organizationId: options.organizationId ?? 'org_git_sources',
      updatedAt: new Date('2026-04-28T12:00:00.000Z'),
    },
  };
}

async function waitForProjectTeardownClaim(): Promise<ProjectProvisioningClaimRow> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const claimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    if (claimed?.action === 'teardown') {
      return claimed;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error('Timed out waiting for project teardown claim.');
}
