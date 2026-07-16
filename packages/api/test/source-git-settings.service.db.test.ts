import { eq } from 'drizzle-orm';
import {
  readGitSourceDescriptorDirectory,
  readGitSourceDescriptorProjectMismatchMessage,
  type WorkerCompleteGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  organizations,
  principals,
  sourceBindings,
  sourceExcludedDescriptors,
  sourceResolutionTasks,
  sourceSyncTaskCandidates,
  sourceSyncTasks,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { SourceMutationTransaction } from '../src/queries/source.query.types';
import { disconnectBindingsBySource, disconnectSource } from '../src/queries/source.query';
import { persistConnectedGitSource } from '../src/services/git-source/git-source-connect.persistence';
import {
  excludeGitSourceDescriptor,
  includeGitSourceDescriptor,
  readGitSourceSettings,
  updateGitSourceSettingsForSource,
} from '../src/services/git-source/git-source-settings.service';
import { queueGitSourceSyncTaskForConnect } from '../src/services/git-source/git-source-sync-task.service';
import { completeGitSourceSyncTaskForWorker as completeGitSourceSyncTaskForWorkerService } from '../src/services/git-source/git-source-sync-worker.service';
import { startGitSourceSync } from '../src/services/git-source/git-source-sync.service';
import type { Actor } from '../src/services/auth-actor.types';
import type { GitSourceSyncTaskView } from '../src/services/git-source/git-source-sync.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { claimSourceSyncTaskForTest } from './source-sync-task-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_settings_service');
const apiConfig: ApiConfig = {
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  caddyTlsMode: 'internal',
  controlPlaneHost: 'console.localhost',
  customTlsDirectory: '/etc/compartment/tls',
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
  auditFileSink: defaultAuditFileSinkConfig,
  rollbackRetentionLimit: null,
  runtimeControlToken: 'test-runtime-control-token',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  sourceArchiveMaxBytes: 104_857_600,
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('44'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

type TestWorkerCompleteGitSourceSyncTaskRequest = Omit<WorkerCompleteGitSourceSyncTaskRequest, 'claimToken'> & {
  claimToken?: string;
};

describe('git source settings service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await createSettingsScope();
    },
  });

  it('reads and updates source settings', async (): Promise<void> => {
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.sourceId, sourceId)),
      'bootstrap source sync task',
    );

    await expect(readGitSourceSettings(createSettingsContext(sourceId))).resolves.toEqual({
      autoAdoptNewApps: true,
      exclusions: [],
    });
    expect(bootstrapTask).toMatchObject({
      requestedByPrincipalId: 'prn_git_settings',
      status: 'pending',
    });

    await expect(
      updateGitSourceSettingsForSource({
        ...createSettingsContext(sourceId),
        autoAdoptNewApps: false,
        sourceId,
      }),
    ).resolves.toEqual({
      autoAdoptNewApps: false,
      exclusions: [],
    });
  });

  it('bootstrap adopts current descriptors even when future auto-adopt is disabled, but later sync skips new apps', async (): Promise<void> => {
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: false });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('alpha', 'apps/alpha/compartment.yml')],
      resolvedCommitSha: 'sha_bootstrap_alpha',
      taskId: bootstrapTaskId,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual(['apps/alpha/compartment.yml']);

    const manualTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('beta', 'apps/beta/compartment.yml')],
      resolvedCommitSha: 'sha_manual_beta',
      taskId: manualTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual(['apps/alpha/compartment.yml']);
    expect(
      await db
        .select()
        .from(sourceSyncTaskCandidates)
        .where(eq(sourceSyncTaskCandidates.sourceSyncTaskId, manualTask.id)),
    ).toMatchObject([
      {
        blockedReason: 'Descriptor was not found on the sync branch.',
        descriptorPath: 'apps/alpha/compartment.yml',
        projectName: 'alpha',
        status: 'blocked',
      },
    ]);
  });

  it('surfaces a blocked latest-sync candidate when an active descriptor disappears from the branch', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });

    const manualTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      resolvedCommitSha: 'sha_manual_missing_billing',
      taskId: manualTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([descriptorPath]);
    expect(await readStoredTaskCandidates(manualTask.id)).toMatchObject([
      {
        blockedReason: 'Descriptor was not found on the sync branch.',
        descriptorPath,
        projectName: 'billing',
        status: 'blocked',
      },
    ]);
  });

  it('preserves an active binding but surfaces worker-reported descriptor invalidation', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });

    const resolutionTaskCount: number = await readSourceResolutionTaskCount(sourceId);
    const manualTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        createBlockedSyncCandidate(descriptorPath, 'Descriptor apps/billing/compartment.yml is invalid: invalid yaml'),
      ],
      resolvedCommitSha: 'sha_manual_invalid_billing',
      taskId: manualTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([descriptorPath]);
    expect(await readSourceResolutionTaskCount(sourceId)).toBe(resolutionTaskCount);
    expect(await readStoredTaskCandidates(manualTask.id)).toMatchObject([
      {
        blockedReason: 'Descriptor apps/billing/compartment.yml is invalid: invalid yaml',
        descriptorPath,
        projectName: null,
        status: 'blocked',
      },
    ]);
  });

  it('surfaces descriptor name drift for an active binding without rebinding the project', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });

    const resolutionTaskCount: number = await readSourceResolutionTaskCount(sourceId);
    const manualTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing-renamed', descriptorPath)],
      resolvedCommitSha: 'sha_manual_renamed_billing',
      taskId: manualTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([descriptorPath]);
    expect(await readSourceResolutionTaskCount(sourceId)).toBe(resolutionTaskCount);
    expect(await readStoredTaskCandidates(manualTask.id)).toMatchObject([
      {
        blockedReason: readGitSourceDescriptorProjectMismatchMessage(descriptorPath, 'billing-renamed', 'billing'),
        descriptorPath,
        projectName: 'billing-renamed',
        status: 'blocked',
      },
    ]);
  });

  it('exclude disconnects the binding, cancels pending resolution work, and prevents resurrection on later sync', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });

    await excludeGitSourceDescriptor({
      ...createSettingsContext(sourceId),
      descriptorPath,
      sourceId,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([]);
    expect(
      await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, sourceId)),
    ).toMatchObject([
      {
        descriptorPath,
      },
    ]);
    expect(
      await db.select().from(sourceResolutionTasks).where(eq(sourceResolutionTasks.sourceId, sourceId)),
    ).toMatchObject([
      {
        failureReason: 'Git source binding was excluded from source sync.',
        status: 'canceled',
      },
    ]);

    const manualTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_manual_billing',
      taskId: manualTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([]);
    expect(
      await db
        .select()
        .from(sourceSyncTaskCandidates)
        .where(eq(sourceSyncTaskCandidates.sourceSyncTaskId, manualTask.id)),
    ).toEqual([]);
  });

  it('repeated exclude preserves the original exclusion creator', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });

    await excludeGitSourceDescriptor({
      ...createSettingsContext(sourceId, 'prn_git_settings'),
      descriptorPath,
      sourceId,
    });
    await excludeGitSourceDescriptor({
      ...createSettingsContext(sourceId, 'prn_git_settings_reviewer'),
      descriptorPath,
      sourceId,
    });

    expect(
      requireFirst(
        await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, sourceId)),
        'source exclusion',
      ),
    ).toMatchObject({
      createdByPrincipalId: 'prn_git_settings',
      descriptorPath,
    });
  });

  it('reconnect bootstrap reactivates the original disconnected descriptor before duplicate-slug candidates', async (): Promise<void> => {
    const originalDescriptorPath: string = 'apps/site/compartment.yml';
    const duplicateDescriptorPath: string = 'apps/site-dup/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('site', originalDescriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_site',
      taskId: bootstrapTaskId,
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      const now: Date = new Date('2026-04-30T09:30:00.000Z');
      await disconnectBindingsBySource(transaction, sourceId, now);
      await disconnectSource(transaction, sourceId, now);
    });

    const reconnectedSourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const reconnectTaskId: string = await readLatestPendingTaskId(reconnectedSourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        createCompletedSyncCandidate('site', duplicateDescriptorPath),
        createCompletedSyncCandidate('site', originalDescriptorPath),
      ],
      resolvedCommitSha: 'sha_reconnect_site',
      taskId: reconnectTaskId,
    });

    expect(await readActiveBindingDescriptorPaths(reconnectedSourceId)).toEqual([originalDescriptorPath]);
    expect(await readStoredTaskCandidates(reconnectTaskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockedReason: null,
          descriptorPath: originalDescriptorPath,
          projectName: 'site',
          status: 'accepted',
        }),
        expect.objectContaining({
          blockedReason: 'Project "site" already has a disconnected Git binding at apps/site/compartment.yml.',
          descriptorPath: duplicateDescriptorPath,
          projectName: 'site',
          status: 'blocked',
        }),
      ]),
    );
  });

  it('reconnect bootstrap migrates a disconnected binding when its descriptor path moved', async (): Promise<void> => {
    const originalDescriptorPath: string = 'legacy/site/compartment.yml';
    const movedDescriptorPath: string = 'apps/site/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('site', originalDescriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_site',
      taskId: bootstrapTaskId,
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      const now: Date = new Date('2026-04-30T09:30:00.000Z');
      await disconnectBindingsBySource(transaction, sourceId, now);
      await disconnectSource(transaction, sourceId, now);
    });

    const reconnectedSourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const reconnectTaskId: string = await readLatestPendingTaskId(reconnectedSourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('site', movedDescriptorPath)],
      resolvedCommitSha: 'sha_reconnect_moved_site',
      taskId: reconnectTaskId,
    });

    expect(await readActiveBindingDescriptorPaths(reconnectedSourceId)).toEqual([movedDescriptorPath]);
    expect(await readStoredTaskCandidates(reconnectTaskId)).toMatchObject([
      {
        blockedReason: null,
        descriptorPath: movedDescriptorPath,
        projectName: 'site',
        status: 'accepted',
      },
    ]);
    expect(await readStoredSourceBindings(reconnectedSourceId)).toMatchObject([
      {
        descriptorDirectory: 'apps/site',
        descriptorPath: movedDescriptorPath,
        projectName: 'site',
        status: 'active',
      },
    ]);
  });

  it('keeps moved reconnect blocked when multiple descriptors match the disconnected project name', async (): Promise<void> => {
    const originalDescriptorPath: string = 'legacy/site/compartment.yml';
    const appDescriptorPath: string = 'apps/site/compartment.yml';
    const serviceDescriptorPath: string = 'services/site/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('site', originalDescriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_site',
      taskId: bootstrapTaskId,
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      const now: Date = new Date('2026-04-30T09:30:00.000Z');
      await disconnectBindingsBySource(transaction, sourceId, now);
      await disconnectSource(transaction, sourceId, now);
    });

    const reconnectedSourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const reconnectTaskId: string = await readLatestPendingTaskId(reconnectedSourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        createCompletedSyncCandidate('site', appDescriptorPath),
        createCompletedSyncCandidate('site', serviceDescriptorPath),
      ],
      resolvedCommitSha: 'sha_reconnect_ambiguous_site',
      taskId: reconnectTaskId,
    });

    expect(await readActiveBindingDescriptorPaths(reconnectedSourceId)).toEqual([]);
    expect(await readStoredTaskCandidates(reconnectTaskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockedReason: 'Project "site" already has a disconnected Git binding at legacy/site/compartment.yml.',
          descriptorPath: appDescriptorPath,
          projectName: 'site',
          status: 'blocked',
        }),
        expect.objectContaining({
          blockedReason: 'Project "site" already has a disconnected Git binding at legacy/site/compartment.yml.',
          descriptorPath: serviceDescriptorPath,
          projectName: 'site',
          status: 'blocked',
        }),
      ]),
    );
  });

  it('keeps duplicate-slug reconnect blocked when the original disconnected descriptor is broken', async (): Promise<void> => {
    const originalDescriptorPath: string = 'apps/site/compartment.yml';
    const duplicateDescriptorPath: string = 'apps/site-dup/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('site', originalDescriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_site',
      taskId: bootstrapTaskId,
    });

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      const now: Date = new Date('2026-04-30T09:30:00.000Z');
      await disconnectBindingsBySource(transaction, sourceId, now);
      await disconnectSource(transaction, sourceId, now);
    });

    const reconnectedSourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const reconnectTaskId: string = await readLatestPendingTaskId(reconnectedSourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        createBlockedSyncCandidate(
          originalDescriptorPath,
          'Descriptor apps/site/compartment.yml is invalid: invalid yaml',
        ),
        createCompletedSyncCandidate('site', duplicateDescriptorPath),
      ],
      resolvedCommitSha: 'sha_reconnect_site_invalid_original',
      taskId: reconnectTaskId,
    });

    expect(await readActiveBindingDescriptorPaths(reconnectedSourceId)).toEqual([]);
    expect(await readStoredTaskCandidates(reconnectTaskId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockedReason: 'Descriptor apps/site/compartment.yml is invalid: invalid yaml',
          descriptorPath: originalDescriptorPath,
          projectName: null,
          status: 'blocked',
        }),
        expect.objectContaining({
          blockedReason: 'Project "site" already has a disconnected Git binding at apps/site/compartment.yml.',
          descriptorPath: duplicateDescriptorPath,
          projectName: 'site',
          status: 'blocked',
        }),
      ]),
    );
  });

  it('include removes the exclusion and reactivates the binding through the sync pipeline', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });
    await excludeGitSourceDescriptor({
      ...createSettingsContext(sourceId),
      descriptorPath,
      sourceId,
    });

    const includeTask: GitSourceSyncTaskView = await includeGitSourceDescriptor({
      ...createSettingsContext(sourceId),
      descriptorPath,
      sourceId,
    });

    expect(
      await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, sourceId)),
    ).toEqual([]);
    expect(
      requireFirst(
        await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, includeTask.id)),
        'include source sync task',
      ),
    ).toMatchObject({
      adoptionMode: 'incremental',
      requestedByPrincipalId: 'prn_git_settings',
      requestedDescriptorPathsJson: JSON.stringify([descriptorPath]),
      status: 'pending',
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_include_billing',
      taskId: includeTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([descriptorPath]);
  });

  it('include queues deployment resolution for an already active binding', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: true });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_bootstrap_billing',
      taskId: bootstrapTaskId,
    });
    const resolutionTaskCount: number = await readSourceResolutionTaskCount(sourceId);

    const includeTask: GitSourceSyncTaskView = await includeGitSourceDescriptor({
      ...createSettingsContext(sourceId),
      descriptorPath,
      sourceId,
    });
    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_include_billing',
      taskId: includeTask.id,
    });

    expect(await readSourceResolutionTaskCount(sourceId)).toBe(resolutionTaskCount + 1);
    expect(await readStoredTaskCandidates(includeTask.id)).toMatchObject([
      {
        blockedReason: null,
        descriptorPath,
        projectName: 'billing',
        status: 'accepted',
      },
    ]);
  });

  it('include updates a claimed sync task and completion re-reads the requested descriptor paths', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: false });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      resolvedCommitSha: 'sha_bootstrap_empty',
      taskId: bootstrapTaskId,
    });

    const incrementalTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));
    await db
      .update(sourceSyncTasks)
      .set({
        claimedAt: new Date('2026-04-30T10:01:00.000Z'),
        claimedByWorkerId: 'wrk_sync',
        leaseExpiresAt: new Date('2026-04-30T10:06:00.000Z'),
        status: 'claimed',
      })
      .where(eq(sourceSyncTasks.id, incrementalTask.id));
    await db.insert(sourceExcludedDescriptors).values({
      createdByPrincipalId: 'prn_git_settings',
      descriptorPath,
      id: 'sed_include_claimed',
      sourceId,
      updatedAt: new Date('2026-04-30T10:02:00.000Z'),
    });

    const includeTask: GitSourceSyncTaskView = await includeGitSourceDescriptor({
      ...createSettingsContext(sourceId),
      descriptorPath,
      sourceId,
    });

    expect(includeTask.id).toBe(incrementalTask.id);
    expect(
      requireFirst(
        await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, includeTask.id)),
        'claimed include source sync task',
      ),
    ).toMatchObject({
      requestedByPrincipalId: 'prn_git_settings',
      requestedDescriptorPathsJson: JSON.stringify([descriptorPath]),
      status: 'claimed',
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [createCompletedSyncCandidate('billing', descriptorPath)],
      resolvedCommitSha: 'sha_include_claimed_billing',
      taskId: includeTask.id,
    });

    expect(await readActiveBindingDescriptorPaths(sourceId)).toEqual([descriptorPath]);
  });

  it('include rejects a live task that belongs to another principal and preserves the exclusion', async (): Promise<void> => {
    const descriptorPath: string = 'apps/billing/compartment.yml';
    const sourceId: string = await connectSettingsSource({ autoAdoptNewApps: false });
    const bootstrapTaskId: string = await readOnlyTaskId(sourceId);

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      resolvedCommitSha: 'sha_bootstrap_empty',
      taskId: bootstrapTaskId,
    });

    const incrementalTask: GitSourceSyncTaskView = await startGitSourceSync(createSettingsContext(sourceId));
    await db
      .update(sourceSyncTasks)
      .set({
        claimedAt: new Date('2026-04-30T10:11:00.000Z'),
        claimedByWorkerId: 'wrk_sync',
        leaseExpiresAt: new Date('2026-04-30T10:16:00.000Z'),
        status: 'claimed',
      })
      .where(eq(sourceSyncTasks.id, incrementalTask.id));
    await db.insert(sourceExcludedDescriptors).values({
      createdByPrincipalId: 'prn_git_settings',
      descriptorPath,
      id: 'sed_include_foreign_claimed',
      sourceId,
      updatedAt: new Date('2026-04-30T10:12:00.000Z'),
    });

    await expect(
      includeGitSourceDescriptor({
        ...createSettingsContext(sourceId, 'prn_git_settings_reviewer'),
        descriptorPath,
        sourceId,
      }),
    ).rejects.toMatchObject({
      code: 'git_source_conflict',
      message: 'A source sync is already in progress. Retry after the current sync completes.',
    });

    expect(
      requireFirst(
        await db.select().from(sourceExcludedDescriptors).where(eq(sourceExcludedDescriptors.sourceId, sourceId)),
        'preserved source exclusion',
      ),
    ).toMatchObject({
      descriptorPath,
    });
    expect(
      requireFirst(
        await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, incrementalTask.id)),
        'unchanged claimed source sync task',
      ),
    ).toMatchObject({
      requestedByPrincipalId: 'prn_git_settings',
      requestedDescriptorPathsJson: '[]',
      status: 'claimed',
    });
  });
});

async function createSettingsScope(): Promise<void> {
  await db.insert(principals).values([
    {
      email: 'git-settings@example.com',
      id: 'prn_git_settings',
      type: 'user',
    },
    {
      email: 'git-settings-reviewer@example.com',
      id: 'prn_git_settings_reviewer',
      type: 'user',
    },
  ]);
  await db.insert(organizations).values({
    id: 'org_git_settings',
    name: 'Git Settings Org',
    slug: 'git-settings-org',
  });
  await db.insert(gitProviderRegistrations).values({
    appId: 'app_settings',
    appName: 'Compartment GitHub App',
    appSlug: 'compartment-github-app',
    appUrl: 'https://github.com/apps/compartment-github-app',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdByPrincipalId: 'prn_git_settings',
    id: 'gpr_git_settings',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookSecretCiphertext: null,
    webhookSecretEncryptionKeyId: null,
    webhookUrl:
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_settings/registrations/gpr_git_settings/webhook',
  });
}

async function connectSettingsSource({ autoAdoptNewApps }: { autoAdoptNewApps: boolean }): Promise<string> {
  await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    const source: typeof sources.$inferSelect = await persistConnectedGitSource(
      transaction,
      {
        actorPrincipalId: 'prn_git_settings',
        installationId: '501',
        organizationId: 'org_git_settings',
        providerHost: 'github.com',
        providerRegistrationId: 'gpr_git_settings',
        repository: {
          defaultBranchName: 'main',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryExternalId: '101',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
        },
        request: {
          autoAdoptNewApps,
          defaultAutoDeployEnabled: true,
          defaultEnvironmentName: 'production',
          providerHost: 'github.com',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          syncBranchName: 'main',
        },
        syncBranchName: 'main',
      },
      new Date('2026-04-30T09:00:00.000Z'),
    );
    await queueGitSourceSyncTaskForConnect(transaction, source, 'prn_git_settings');
  });

  return requireFirst(await db.select().from(sources), 'source').id;
}

function createSettingsContext(
  sourceId: string,
  principalId: string = 'prn_git_settings',
): { actor: Actor; organizationId: string; sourceId: string } {
  return {
    actor: createActor(principalId),
    organizationId: 'org_git_settings',
    sourceId,
  };
}

function createActor(principalId: string): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId,
    },
    memberships: [
      {
        role: 'admin',
        scopeId: 'org_git_settings',
        scopeType: 'organization',
      },
    ],
    principalEmail:
      principalId === 'prn_git_settings' ? 'git-settings@example.com' : 'git-settings-reviewer@example.com',
    principalId,
    principalType: 'user',
    sessionId: 'ses_git_settings',
    tokenHash: 'tok_git_settings',
  };
}

async function completeGitSourceSyncTaskForWorker(input: TestWorkerCompleteGitSourceSyncTaskRequest): Promise<void> {
  await completeGitSourceSyncTaskForWorkerService({
    ...input,
    claimToken: input.claimToken ?? (await claimSourceSyncTaskForTest(db, input.taskId, apiConfig.runtimeControlToken)),
  });
}

function createCompletedSyncCandidate(
  projectName: string,
  descriptorPath: string,
): {
  blockedReason: null;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  projectName: string;
} {
  return {
    blockedReason: null,
    derivedWatchPaths: [readGitSourceDescriptorDirectory(descriptorPath)],
    descriptorDirectory: readGitSourceDescriptorDirectory(descriptorPath),
    descriptorPath,
    projectName,
  };
}

function createBlockedSyncCandidate(
  descriptorPath: string,
  blockedReason: string,
): {
  blockedReason: string;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  projectName: null;
} {
  return {
    blockedReason,
    derivedWatchPaths: [],
    descriptorDirectory: readGitSourceDescriptorDirectory(descriptorPath),
    descriptorPath,
    projectName: null,
  };
}

async function readOnlyTaskId(sourceId: string): Promise<string> {
  const tasks: (typeof sourceSyncTasks.$inferSelect)[] = await db
    .select()
    .from(sourceSyncTasks)
    .where(eq(sourceSyncTasks.sourceId, sourceId));

  return requireFirst(tasks, 'source sync task').id;
}

async function readLatestPendingTaskId(sourceId: string): Promise<string> {
  const tasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);

  return requireFirst(
    tasks
      .filter(
        (task: typeof sourceSyncTasks.$inferSelect): boolean => task.sourceId === sourceId && task.status === 'pending',
      )
      .sort(
        (left: typeof sourceSyncTasks.$inferSelect, right: typeof sourceSyncTasks.$inferSelect): number =>
          right.createdAt.getTime() - left.createdAt.getTime(),
      ),
    'latest pending source sync task',
  ).id;
}

async function readStoredTaskCandidates(taskId: string): Promise<(typeof sourceSyncTaskCandidates.$inferSelect)[]> {
  return await db.select().from(sourceSyncTaskCandidates).where(eq(sourceSyncTaskCandidates.sourceSyncTaskId, taskId));
}

async function readSourceResolutionTaskCount(sourceId: string): Promise<number> {
  return (await db.select().from(sourceResolutionTasks).where(eq(sourceResolutionTasks.sourceId, sourceId))).length;
}

async function readActiveBindingDescriptorPaths(sourceId: string): Promise<string[]> {
  const bindings: (typeof sourceBindings.$inferSelect)[] = await db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.sourceId, sourceId));

  return bindings
    .filter((binding: typeof sourceBindings.$inferSelect): boolean => binding.status === 'active')
    .map((binding: typeof sourceBindings.$inferSelect): string => binding.descriptorPath)
    .sort((left: string, right: string): number => left.localeCompare(right));
}

async function readStoredSourceBindings(sourceId: string): Promise<(typeof sourceBindings.$inferSelect)[]> {
  return await db.select().from(sourceBindings).where(eq(sourceBindings.sourceId, sourceId));
}

function requireFirst<T>(values: readonly T[], label: string): T {
  const value: T | undefined = values[0];
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist.`);
  }

  return value;
}
