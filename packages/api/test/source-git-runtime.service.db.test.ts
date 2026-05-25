import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import type {
  GitSourceBindingInput,
  WorkerCompleteGitSourceSyncTaskRequest,
  WorkerFailGitSourceSyncTaskRequest,
} from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  auditEvents,
  gitProviderRegistrations,
  localCredentials,
  organizations,
  organizationMemberships,
  principals,
  sourceBindings,
  sourceEvents,
  sourceResolutionTasks,
  sourceSyncTaskCandidates,
  sourceSyncTasks,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import type { SourceMutationTransaction, SourceRow } from '../src/queries/source.query.types';
import { persistConnectedGitSource } from '../src/services/git-source/git-source-connect.persistence';
import { adoptGitSourceBinding } from '../src/services/git-source/git-source-binding-adoption.service';
import {
  completeGitSourceResolutionTaskForWorker,
  failGitSourceResolutionTaskForWorker,
} from '../src/services/git-source/git-source-resolution-worker.service';
import { handleGitHubSourceWebhook } from '../src/services/git-source/git-source-runtime.service';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../src/services/rbac-seed.service';
import {
  completeGitSourceSyncTaskForWorker as completeGitSourceSyncTaskForWorkerService,
  failGitSourceSyncTaskForWorker as failGitSourceSyncTaskForWorkerService,
} from '../src/services/git-source/git-source-sync-worker.service';
import { claimNextSourceSyncTask, createSourceSyncTask } from '../src/queries/source-sync.query';
import { createSourceSyncClaimToken } from '../src/queries/source-sync-claim-token.query.support';
import type {
  GitHubWebhookObject,
  GitHubWebhookValue,
  HandleGitHubSourceWebhookInput,
} from '../src/services/git-source/git-source-runtime.service.types';
import { claimNextSourceResolutionTask } from '../src/queries/source-resolution.query';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { claimSourceSyncTaskForTest } from './source-sync-task-test.fixtures';
import { encryptVariableValueForStorageForTests, type TestEncryptedVariableValue } from './variables-test-crypto';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_runtime_service');
const webhookSecretParts: readonly [string, string] = ['webhook', 'secret'];
const webhookSecret: string = webhookSecretParts.join('-');
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
  runtimeDefaultUpstreamHost: '127.0.0.1',
  sessionSecret: 'test-secret',
  sessionTtlMs: 604_800_000,
  sourceArchiveDirectory: '/tmp/compartment-test-source-archives',
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
  sourceArchiveMaxBytes: 104_857_600,
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('22'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

type TestWorkerCompleteGitSourceSyncTaskRequest = Omit<WorkerCompleteGitSourceSyncTaskRequest, 'claimToken'> & {
  claimToken?: string;
};
type TestWorkerFailGitSourceSyncTaskRequest = Omit<WorkerFailGitSourceSyncTaskRequest, 'claimToken'> & {
  claimToken?: string;
};

describe('git source runtime service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await createRuntimeScope();
    },
  });

  it('creates a source event and only matching resolution tasks for a verified push', async (): Promise<void> => {
    await connectRuntimeSource([
      createBinding('billing', 'apps/billing/compartment.yml'),
      createBinding('hr', 'apps/hr/compartment.yml'),
    ]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/billing/app.py'],
          commitSha: 'sha_push_billing',
        }),
        providerDeliveryId: 'delivery_push_billing',
      }),
    );

    const storedEvents: (typeof sourceEvents.$inferSelect)[] = await db.select().from(sourceEvents);
    const storedAuditEvents: (typeof auditEvents.$inferSelect)[] = await db.select().from(auditEvents);
    const storedTasks: (typeof sourceResolutionTasks.$inferSelect)[] = await db.select().from(sourceResolutionTasks);
    const storedSyncTasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);
    const billingBinding: typeof sourceBindings.$inferSelect | undefined = await readBindingByProjectName('billing');
    const hrBinding: typeof sourceBindings.$inferSelect | undefined = await readBindingByProjectName('hr');
    const storedEvent: typeof sourceEvents.$inferSelect = requireFirst(storedEvents, 'source event');
    const storedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(storedTasks, 'source resolution task');
    const storedSyncTask: typeof sourceSyncTasks.$inferSelect = requireFirst(storedSyncTasks, 'source sync task');
    const storedSource: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');

    expect(storedEvents).toHaveLength(1);
    expect(storedEvent).toMatchObject({
      branchName: 'main',
      changedFilesComplete: true,
      commitSha: 'sha_push_billing',
      eventType: 'push',
      providerDeliveryId: 'delivery_push_billing',
      status: 'tasks_created',
    });
    expect(readChangedFilesJson(storedEvent.changedFilesJson)).toEqual(['apps/billing/app.py']);

    expect(storedTasks).toHaveLength(1);
    expect(storedTask).toMatchObject({
      branchName: 'main',
      commitSha: 'sha_push_billing',
      sourceBindingId: billingBinding?.id,
      status: 'pending',
      targetEnvironmentName: 'production',
    });
    expect(storedTask.sourceBindingId).not.toBe(hrBinding?.id);
    expect(readAuditEventTypes(storedAuditEvents)).toEqual(
      expect.arrayContaining(['source.auto_deploy.queued', 'source.push.received']),
    );
    expect(storedSyncTasks).toHaveLength(1);
    expect(storedSyncTask).toMatchObject({
      requestedByPrincipalId: storedSource.automationPrincipalId,
      requestedBranchName: 'main',
      resolvedCommitSha: null,
      sourceId: storedEvent.sourceId,
      status: 'pending',
    });
    expect(storedSource.automationPrincipalId).not.toBeNull();
  });

  it('does not duplicate events or tasks for a repeated delivery id', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    const payload: GitHubPushPayload = createPushPayload({
      changedPaths: ['apps/billing/app.py'],
      commitSha: 'sha_push_repeat',
    });

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload,
        providerDeliveryId: 'delivery_push_repeat',
      }),
    );
    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload,
        providerDeliveryId: 'delivery_push_repeat',
      }),
    );

    expect(await db.select().from(sourceEvents)).toHaveLength(1);
    expect(await db.select().from(sourceResolutionTasks)).toHaveLength(1);
    expect(await db.select().from(sourceSyncTasks)).toHaveLength(1);
    expect(await db.select().from(auditEvents)).toHaveLength(2);
  });

  it.each<ExistingResolutionTaskState>([
    {
      label: 'pending',
      values: {},
    },
    {
      label: 'claimed',
      values: {
        claimedAt: new Date('2026-04-29T10:20:00.000Z'),
        claimantId: 'wrk_existing_resolution',
        leaseExpiresAt: new Date('2026-04-29T10:25:00.000Z'),
        status: 'claimed',
      },
    },
    {
      label: 'completed',
      values: {
        completedAt: new Date('2026-04-29T10:30:00.000Z'),
        status: 'completed',
      },
    },
  ])(
    'completes a new push event when its matching resolution task already exists as $label',
    async ({ values }: ExistingResolutionTaskState): Promise<void> => {
      await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

      const payload: GitHubPushPayload = createPushPayload({
        changedPaths: ['apps/billing/app.py'],
        commitSha: 'sha_push_completed_repeat',
      });

      await handleGitHubSourceWebhook(
        createWebhookInput({
          eventType: 'push',
          payload,
          providerDeliveryId: 'delivery_push_completed_initial',
        }),
      );

      const initialTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
        await db.select().from(sourceResolutionTasks),
        'source resolution task',
      );
      if (Object.keys(values).length > 0) {
        await db.update(sourceResolutionTasks).set(values).where(eq(sourceResolutionTasks.id, initialTask.id));
      }

      await handleGitHubSourceWebhook(
        createWebhookInput({
          eventType: 'push',
          payload,
          providerDeliveryId: 'delivery_push_completed_repeat',
        }),
      );

      const repeatedEvent: typeof sourceEvents.$inferSelect = requireFirst(
        (await db.select().from(sourceEvents)).filter(
          (event: typeof sourceEvents.$inferSelect): boolean =>
            event.providerDeliveryId === 'delivery_push_completed_repeat',
        ),
        'repeated source event',
      );

      expect(await db.select().from(sourceResolutionTasks)).toHaveLength(1);
      expect(repeatedEvent.status).toBe('completed');
      expect(repeatedEvent.completedAt).toBeInstanceOf(Date);
    },
  );

  it('queues source sync for a source-only repository push on the sync branch', async (): Promise<void> => {
    await connectRuntimeSource([]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/web/compartment.yml'],
          commitSha: 'sha_push_source_only',
        }),
        providerDeliveryId: 'delivery_push_source_only',
      }),
    );

    const storedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      await db.select().from(sourceEvents),
      'source event',
    );
    const storedAuditEvents: (typeof auditEvents.$inferSelect)[] = await db.select().from(auditEvents);
    const autoDeployAuditEvent: typeof auditEvents.$inferSelect = requireFirst(
      storedAuditEvents.filter(
        (event: typeof auditEvents.$inferSelect): boolean => event.eventType === 'source.auto_deploy.skipped',
      ),
      'auto-deploy skipped audit event',
    );
    const storedSyncTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      await db.select().from(sourceSyncTasks),
      'source sync task',
    );

    expect(await db.select().from(sourceResolutionTasks)).toEqual([]);
    expect(storedEvent).toMatchObject({
      branchName: 'main',
      providerDeliveryId: 'delivery_push_source_only',
      status: 'completed',
    });
    expect(storedSyncTask).toMatchObject({
      requestedBranchName: 'main',
      status: 'pending',
    });
    expect(readAuditEventTypes(storedAuditEvents)).toEqual(
      expect.arrayContaining(['source.auto_deploy.skipped', 'source.push.received']),
    );
    expect(JSON.parse(autoDeployAuditEvent.metadataJson)).toMatchObject({
      commitSha: 'sha_push_source_only',
      resolutionTaskCount: 0,
    });
  });

  it('updates a live automation-owned sync task with the newest push trigger metadata', async (): Promise<void> => {
    await connectRuntimeSource([]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/first/compartment.yml'],
          commitSha: 'sha_push_pending_trigger_first',
        }),
        providerDeliveryId: 'delivery_push_pending_trigger_first',
      }),
    );
    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/web/compartment.yml'],
          commitSha: 'sha_push_pending_trigger_second',
        }),
        providerDeliveryId: 'delivery_push_pending_trigger_second',
      }),
    );

    const storedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      (await db.select().from(sourceEvents)).filter(
        (event: typeof sourceEvents.$inferSelect): boolean => event.commitSha === 'sha_push_pending_trigger_second',
      ),
      'latest source event',
    );
    const storedTasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);
    const storedSource: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');

    expect(storedTasks).toHaveLength(1);
    expect(requireFirst(storedTasks, 'source sync task')).toMatchObject({
      adoptionMode: 'incremental',
      requestedByPrincipalId: storedSource.automationPrincipalId,
      requestedBranchName: 'main',
      status: 'pending',
      triggerCommitSha: 'sha_push_pending_trigger_second',
      triggerSourceEventId: storedEvent.id,
    });
  });

  it('queues a follow-up automation sync when a push lands before a manual task is claimed', async (): Promise<void> => {
    await connectRuntimeSource([]);
    const sourceId: string = requireFirst(await db.select().from(sources), 'source').id;
    const pendingTaskId: string = 'sst_pending_manual_follow_up';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: pendingTaskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/web/compartment.yml'],
          commitSha: 'sha_push_before_claim',
        }),
        providerDeliveryId: 'delivery_push_before_claim',
      }),
    );

    expect(
      requireFirst(await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, pendingTaskId)), 'manual task'),
    ).toMatchObject({
      requestedByPrincipalId: 'prn_git_runtime',
      triggerCommitSha: null,
      triggerSourceEventId: null,
    });

    await db
      .update(sourceSyncTasks)
      .set({
        claimedAt: new Date('2026-04-30T10:01:00.000Z'),
        claimedByWorkerId: 'wrk_sync',
        leaseExpiresAt: new Date('2026-04-30T10:06:00.000Z'),
        status: 'claimed',
      })
      .where(eq(sourceSyncTasks.id, pendingTaskId));

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      resolvedCommitSha: 'sha_sync_manual_after_push',
      taskId: pendingTaskId,
    });

    const storedTasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);
    const completedTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      storedTasks.filter((task: typeof sourceSyncTasks.$inferSelect): boolean => task.id === pendingTaskId),
      'completed manual source sync task',
    );
    const followUpTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      storedTasks.filter((task: typeof sourceSyncTasks.$inferSelect): boolean => task.id !== pendingTaskId),
      'follow-up automation source sync task',
    );
    const storedSource: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');

    expect(storedTasks).toHaveLength(2);
    expect(completedTask).toMatchObject({
      requestedByPrincipalId: 'prn_git_runtime',
      resolvedCommitSha: 'sha_sync_manual_after_push',
      status: 'completed',
    });
    expect(followUpTask).toMatchObject({
      requestedByPrincipalId: storedSource.automationPrincipalId,
      requestedBranchName: 'main',
      triggerCommitSha: 'sha_push_before_claim',
      status: 'pending',
    });
    expect(readAuditEventTypes(await db.select().from(auditEvents))).toContain('source.sync.succeeded');
  });

  it('records audit events when source sync auto-adopts a binding', async (): Promise<void> => {
    await connectRuntimeSource([]);
    const source: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');
    const taskId: string = 'sst_auto_adopt_audit';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'bootstrap',
        id: taskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId: source.id,
        status: 'claimed',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: ['apps/web'],
          descriptorDirectory: 'apps/web',
          descriptorPath: 'apps/web/compartment.yml',
          projectName: 'web',
        },
      ],
      resolvedCommitSha: 'sha_sync_auto_adopt',
      taskId,
    });

    const binding: typeof sourceBindings.$inferSelect = requireFirst(await db.select().from(sourceBindings), 'binding');
    const storedAuditEvents: (typeof auditEvents.$inferSelect)[] = await db.select().from(auditEvents);
    const bindingAuditEvent: typeof auditEvents.$inferSelect = requireFirst(
      storedAuditEvents.filter(
        (event: typeof auditEvents.$inferSelect): boolean => event.eventType === 'source.binding.created',
      ),
      'binding audit event',
    );

    expect(bindingAuditEvent).toMatchObject({
      actorPrincipalId: source.automationPrincipalId,
      eventType: 'source.binding.created',
      targetDisplayName: 'apps/web/compartment.yml',
      targetId: binding.id,
      targetType: 'source_binding',
    });
    expect(JSON.parse(bindingAuditEvent.metadataJson)).toMatchObject({
      autoDeployEnabled: true,
      branchName: 'main',
      descriptorPath: 'apps/web/compartment.yml',
      environmentName: 'production',
      projectName: 'web',
    });
    expect(readAuditEventTypes(storedAuditEvents)).toContain('source.sync.succeeded');
  });

  it('does not queue resolution tasks for bindings adopted with default auto deploy disabled', async (): Promise<void> => {
    await connectRuntimeSource([], 'main', false);
    const source: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');
    const taskId: string = 'sst_auto_adopt_manual';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'bootstrap',
        id: taskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId: source.id,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: ['apps/web'],
          descriptorDirectory: 'apps/web',
          descriptorPath: 'apps/web/compartment.yml',
          projectName: 'web',
        },
      ],
      resolvedCommitSha: 'sha_sync_manual_auto_deploy',
      taskId,
    });

    const binding: typeof sourceBindings.$inferSelect = requireFirst(await db.select().from(sourceBindings), 'binding');

    expect(binding.autoDeployEnabled).toBe(false);
    expect(await db.select().from(sourceResolutionTasks)).toEqual([]);
    expect(await db.select().from(sourceEvents)).toEqual([]);
  });

  it('refreshes active binding watch paths from source sync discovery', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('web', 'apps/web/compartment.yml')]);
    const source: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');
    const taskId: string = 'sst_refresh_watch_paths';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: taskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId: source.id,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: ['apps/web', 'shared'],
          descriptorDirectory: 'apps/web',
          descriptorPath: 'apps/web/compartment.yml',
          projectName: 'web',
        },
      ],
      resolvedCommitSha: 'sha_sync_watch_paths',
      taskId,
    });

    const refreshedBinding: typeof sourceBindings.$inferSelect = requireFirst(
      await db.select().from(sourceBindings),
      'refreshed binding',
    );

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['shared/runtime.ts'],
          commitSha: 'sha_push_shared',
        }),
        providerDeliveryId: 'delivery_push_shared',
      }),
    );

    const resolutionTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );
    expect(resolutionTask).toMatchObject({
      commitSha: 'sha_push_shared',
      sourceBindingId: refreshedBinding.id,
      status: 'pending',
    });
  });

  it('records audit events when source sync finally fails', async (): Promise<void> => {
    await connectRuntimeSource([]);
    const sourceId: string = requireFirst(await db.select().from(sources), 'source').id;
    const failedTaskId: string = 'sst_final_failure';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: failedTaskId,
        maxAttempts: 1,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'claimed',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });
    await db.update(sourceSyncTasks).set({ attemptCount: 1 }).where(eq(sourceSyncTasks.id, failedTaskId));

    await failGitSourceSyncTaskForWorker({
      failureReason: 'Worker could not inspect repository descriptors.',
      taskId: failedTaskId,
    });

    expect(readAuditEventTypes(await db.select().from(auditEvents))).toContain('source.sync.failed');
  });

  it('does not queue source sync for pushes outside the configured sync branch', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml', 'release')], 'main');

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          branchName: 'release',
          changedPaths: ['apps/billing/app.py'],
          commitSha: 'sha_push_release',
        }),
        providerDeliveryId: 'delivery_push_release',
      }),
    );

    const storedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );

    expect(storedTask).toMatchObject({
      branchName: 'release',
      commitSha: 'sha_push_release',
      status: 'pending',
    });
    expect(await db.select().from(sourceSyncTasks)).toEqual([]);
  });

  it('queues a follow-up source sync after a sync-branch push during a claimed task', async (): Promise<void> => {
    await connectRuntimeSource([]);
    const sourceId: string = requireFirst(await db.select().from(sources), 'source').id;
    const claimedTaskId: string = 'sst_claimed_follow_up';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await transaction.insert(sourceSyncTasks).values({
        adoptionMode: 'incremental',
        claimedAt: new Date('2026-04-29T10:01:00.000Z'),
        claimedByWorkerId: 'wrk_sync',
        id: claimedTaskId,
        leaseExpiresAt: new Date('2026-04-29T10:06:00.000Z'),
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'claimed',
        updatedAt: new Date('2026-04-29T10:01:00.000Z'),
      });
    });

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/web/compartment.yml'],
          commitSha: 'sha_push_follow_up',
        }),
        providerDeliveryId: 'delivery_push_follow_up',
      }),
    );

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      resolvedCommitSha: 'sha_sync_claimed',
      taskId: claimedTaskId,
    });

    const storedTasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);
    const completedTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      storedTasks.filter((task: typeof sourceSyncTasks.$inferSelect): boolean => task.id === claimedTaskId),
      'completed source sync task',
    );
    const followUpTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      storedTasks.filter((task: typeof sourceSyncTasks.$inferSelect): boolean => task.id !== claimedTaskId),
      'follow-up source sync task',
    );
    const storedSource: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');

    expect(storedTasks).toHaveLength(2);
    expect(completedTask).toMatchObject({
      requestedBranchName: 'main',
      resolvedCommitSha: 'sha_sync_claimed',
      sourceId,
      status: 'completed',
    });
    expect(followUpTask).toMatchObject({
      requestedByPrincipalId: storedSource.automationPrincipalId,
      requestedBranchName: 'main',
      resolvedCommitSha: null,
      sourceId,
      status: 'pending',
    });
  });

  it('ignores stale source sync completion after the task is reclaimed', async (): Promise<void> => {
    await connectRuntimeSource([]);
    const sourceId: string = requireFirst(await db.select().from(sources), 'source').id;
    const taskId: string = 'sst_stale_completion_fence';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: taskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_runtime',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      });
    });

    const staleClaim: typeof sourceSyncTasks.$inferSelect = requirePresent(
      await claimNextSourceSyncTask(
        'wrk_stale_sync',
        new Date('2026-04-29T10:01:00.000Z'),
        new Date('2026-04-29T10:02:00.000Z'),
      ),
      'stale source sync claim',
    );
    const currentClaim: typeof sourceSyncTasks.$inferSelect = requirePresent(
      await claimNextSourceSyncTask(
        'wrk_current_sync',
        new Date('2999-04-29T10:03:00.000Z'),
        new Date('2999-04-29T10:08:00.000Z'),
      ),
      'current source sync claim',
    );

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      claimToken: createClaimTokenForTask(staleClaim),
      resolvedCommitSha: 'sha_stale_sync',
      taskId,
    });

    const stillClaimedTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, taskId)),
      'still claimed source sync task',
    );
    expect(stillClaimedTask).toMatchObject({
      claimedByWorkerId: currentClaim.claimedByWorkerId,
      resolvedCommitSha: null,
      status: 'claimed',
    });
    expect(await db.select().from(sourceSyncTaskCandidates)).toEqual([]);
    expect(readAuditEventTypes(await db.select().from(auditEvents))).not.toContain('source.sync.succeeded');

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      claimToken: createClaimTokenForTask(currentClaim, 'wrong-runtime-control-token'),
      resolvedCommitSha: 'sha_forged_sync',
      taskId,
    });

    expect(
      requireFirst(
        await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, taskId)),
        'source sync task after forged claim token',
      ),
    ).toMatchObject({
      claimedByWorkerId: currentClaim.claimedByWorkerId,
      resolvedCommitSha: null,
      status: 'claimed',
    });

    await completeGitSourceSyncTaskForWorker({
      candidates: [],
      claimToken: createClaimTokenForTask(currentClaim),
      resolvedCommitSha: 'sha_current_sync',
      taskId,
    });

    expect(
      requireFirst(
        await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, taskId)),
        'completed current source sync task',
      ),
    ).toMatchObject({
      claimedByWorkerId: null,
      resolvedCommitSha: 'sha_current_sync',
      status: 'completed',
    });
  });

  it('resets attempt count when requeueing a previously failed resolution task', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    const payload: GitHubPushPayload = createPushPayload({
      changedPaths: ['apps/billing/app.py'],
      commitSha: 'sha_push_requeue',
    });

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload,
        providerDeliveryId: 'delivery_push_requeue_initial',
      }),
    );

    const initialTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );

    await db
      .update(sourceResolutionTasks)
      .set({
        attemptCount: initialTask.maxAttempts,
        completedAt: new Date(),
        failureReason: 'failed once',
        status: 'failed',
      })
      .where(eq(sourceResolutionTasks.id, initialTask.id));

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload,
        providerDeliveryId: 'delivery_push_requeue_repeat',
      }),
    );

    const requeuedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );

    expect(requeuedTask).toMatchObject({
      attemptCount: 0,
      failureReason: null,
      status: 'pending',
    });
  });

  it('fails a claimed resolution task immediately when the worker marks the failure as non-retryable', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/billing/app.py'],
          commitSha: 'sha_push_non_retryable',
        }),
        providerDeliveryId: 'delivery_push_non_retryable',
      }),
    );

    const claimedTask: typeof sourceResolutionTasks.$inferSelect = requireClaimedSourceResolutionTask(
      await claimNextSourceResolutionTask('wrk_test', new Date(), new Date(Date.now() + 60_000)),
    );

    await failGitSourceResolutionTaskForWorker({
      failureReason: 'Descriptor apps/billing/compartment.yml was not found on the source branch.',
      retryable: false,
      taskId: claimedTask.id,
    });

    const failedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );
    const completedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      await db.select().from(sourceEvents),
      'source event',
    );

    expect(failedTask).toMatchObject({
      attemptCount: 1,
      failureReason: 'Descriptor apps/billing/compartment.yml was not found on the source branch.',
      status: 'failed',
    });
    expect(failedTask.completedAt).toBeInstanceOf(Date);
    expect(completedEvent.status).toBe('completed');
    expect(completedEvent.completedAt).toBeInstanceOf(Date);
  });
  it('treats incomplete changed file lists as affecting branch-matched bindings', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['README.md'],
          commitSha: 'sha_push_incomplete',
          size: 2,
        }),
        providerDeliveryId: 'delivery_push_incomplete',
      }),
    );

    const storedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      await db.select().from(sourceEvents),
      'source event',
    );
    const storedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );

    expect(storedEvent).toMatchObject({
      changedFilesComplete: false,
      providerDeliveryId: 'delivery_push_incomplete',
      status: 'tasks_created',
    });
    expect(storedTask).toMatchObject({
      commitSha: 'sha_push_incomplete',
      status: 'pending',
    });
  });

  it('verifies the webhook signature before payload validation', async (): Promise<void> => {
    const rawBody: Buffer = Buffer.from(JSON.stringify({ invalid: true }), 'utf8');
    const invalidBody: GitHubWebhookObject = {};

    await expect(
      handleGitHubSourceWebhook({
        body: invalidBody,
        eventType: 'push',
        providerDeliveryId: 'delivery_invalid_signature',
        rawBody,
        registrationId: 'gpr_git_runtime',
        organizationId: 'org_git_runtime',
        signature: 'sha256=invalid',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_unauthorized',
    });

    await expect(
      handleGitHubSourceWebhook({
        body: invalidBody,
        eventType: 'push',
        providerDeliveryId: 'delivery_invalid_payload',
        rawBody,
        registrationId: 'gpr_git_runtime',
        organizationId: 'org_git_runtime',
        signature: signGitHubWebhookBody(rawBody),
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_invalid',
    });
  });

  it('rejects a valid signed webhook when the path organization does not own the registration', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);
    const input: HandleGitHubSourceWebhookInput = createWebhookInput({
      eventType: 'push',
      payload: createPushPayload({
        changedPaths: ['apps/billing/app.py'],
        commitSha: 'sha_push_wrong_org',
      }),
      providerDeliveryId: 'delivery_push_wrong_org',
    });

    await expect(
      handleGitHubSourceWebhook({
        ...input,
        organizationId: 'org_wrong_path',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_invalid',
    });

    expect(await db.select().from(sourceEvents)).toHaveLength(0);
    expect(await db.select().from(sourceResolutionTasks)).toHaveLength(0);
    expect(await db.select().from(sourceSyncTasks)).toHaveLength(0);
  });

  it('disables sources, cancels open tasks, and blocks later push queueing after repo access loss', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/billing/app.py'],
          commitSha: 'sha_push_disable',
        }),
        providerDeliveryId: 'delivery_push_disable',
      }),
    );

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'installation_repositories',
        payload: createInstallationRepositoriesRemovedPayload(),
        providerDeliveryId: 'delivery_installation_removed',
      }),
    );

    const storedSource: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');
    const storedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      await db.select().from(sourceEvents),
      'source event',
    );
    const storedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );

    expect(storedSource).toMatchObject({
      status: 'disabled',
    });
    expect(storedTask).toMatchObject({
      failureReason: 'Git provider access was removed for this source.',
      status: 'canceled',
    });
    expect(storedEvent.status).toBe('completed');
    expect(storedEvent.completedAt).toBeInstanceOf(Date);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/billing/second.py'],
          commitSha: 'sha_push_after_disable',
        }),
        providerDeliveryId: 'delivery_push_after_disable',
      }),
    );

    expect(await db.select().from(sourceEvents)).toHaveLength(1);
    expect(await db.select().from(sourceResolutionTasks)).toHaveLength(1);
  });

  it('completes claimed tasks without retries when the source becomes disabled before completion', async (): Promise<void> => {
    await connectRuntimeSource([createBinding('billing', 'apps/billing/compartment.yml')]);

    await handleGitHubSourceWebhook(
      createWebhookInput({
        eventType: 'push',
        payload: createPushPayload({
          changedPaths: ['apps/billing/app.py'],
          commitSha: 'sha_push_disabled_completion',
        }),
        providerDeliveryId: 'delivery_push_disabled_completion',
      }),
    );

    const claimedTask: typeof sourceResolutionTasks.$inferSelect = requireClaimedSourceResolutionTask(
      await claimNextSourceResolutionTask('wrk_test', new Date(), new Date(Date.now() + 60_000)),
    );
    const source: typeof sources.$inferSelect = requireFirst(await db.select().from(sources), 'source');

    await db.update(sources).set({ status: 'disabled' }).where(eq(sources.id, source.id));

    await completeGitSourceResolutionTaskForWorker({
      descriptor: {
        name: 'billing',
        services: {
          web: '.',
        },
      },
      taskId: claimedTask.id,
    });

    const completedTask: typeof sourceResolutionTasks.$inferSelect = requireFirst(
      await db.select().from(sourceResolutionTasks),
      'source resolution task',
    );
    const completedEvent: typeof sourceEvents.$inferSelect = requireFirst(
      await db.select().from(sourceEvents),
      'source event',
    );

    expect(completedTask).toMatchObject({
      attemptCount: 1,
      failureReason: null,
      status: 'completed',
    });
    expect(completedTask.completedAt).toBeInstanceOf(Date);
    expect(completedEvent.status).toBe('completed');
    expect(completedEvent.completedAt).toBeInstanceOf(Date);
  });
});

interface CreatePushPayloadInput {
  branchName?: string | undefined;
  changedPaths: string[];
  commitSha: string;
  size?: number | undefined;
}

interface CreateWebhookInputOptions {
  eventType: string;
  payload: GitHubWebhookObject;
  providerDeliveryId: string;
}

interface GitHubCommitPayload extends GitHubWebhookObject {
  added: string[];
  modified: string[];
  removed: string[];
}

interface GitHubPushPayload extends GitHubWebhookObject {
  after: string;
  commits: GitHubCommitPayload[];
  installation: {
    id: number;
  };
  ref: string;
  repository: {
    id: number;
    name: string;
    owner: {
      login: string;
    };
  };
  size: number;
}

interface ExistingResolutionTaskState {
  label: string;
  values: Partial<typeof sourceResolutionTasks.$inferSelect>;
}

function requireClaimedSourceResolutionTask(
  task: typeof sourceResolutionTasks.$inferSelect | null,
): typeof sourceResolutionTasks.$inferSelect {
  if (task === null) {
    throw new Error('Expected a claimed source resolution task.');
  }

  return task;
}

async function createRuntimeScope(): Promise<void> {
  const encryptedWebhookSecret: TestEncryptedVariableValue = encryptVariableValueForStorageForTests(
    webhookSecret,
    apiConfig.variablesMasterKey,
  );

  await db.insert(principals).values({
    email: 'git-runtime@example.com',
    id: 'prn_git_runtime',
    type: 'user',
  });
  await db.insert(localCredentials).values({
    passwordHash: 'git-runtime-password-hash',
    principalId: 'prn_git_runtime',
  });
  await db.insert(organizations).values({
    id: 'org_git_runtime',
    name: 'Git Runtime Org',
    slug: 'git-runtime-org',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_git_runtime',
    organizationId: 'org_git_runtime',
    principalId: 'prn_git_runtime',
  });
  await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    await assignOrganizationSystemRoleToPrincipalWithExecutor(
      transaction,
      'org_git_runtime',
      'prn_git_runtime',
      'admin',
    );
  });
  await db.insert(gitProviderRegistrations).values({
    appId: 'app_123',
    appName: 'Compartment GitHub App',
    appSlug: 'compartment-github-app',
    appUrl: 'https://github.com/apps/compartment-github-app',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdByPrincipalId: 'prn_git_runtime',
    id: 'gpr_git_runtime',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    webhookSecretCiphertext: encryptedWebhookSecret.valueCiphertext,
    webhookSecretEncryptionKeyId: encryptedWebhookSecret.encryptionKeyId,
    webhookUrl:
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_runtime/registrations/gpr_git_runtime/webhook',
  });
}

async function connectRuntimeSource(
  bindings: GitSourceBindingInput[],
  syncBranchName: string = 'main',
  defaultAutoDeployEnabled: boolean = true,
): Promise<void> {
  await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    const source: SourceRow = await persistConnectedGitSource(
      transaction,
      {
        actorPrincipalId: 'prn_git_runtime',
        installationId: '501',
        organizationId: 'org_git_runtime',
        providerHost: 'github.com',
        providerRegistrationId: 'gpr_git_runtime',
        repository: {
          defaultBranchName: 'main',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryExternalId: '101',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
        },
        request: {
          autoAdoptNewApps: true,
          defaultAutoDeployEnabled,
          defaultEnvironmentName: 'production',
          providerHost: 'github.com',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          syncBranchName,
        },
        syncBranchName,
      },
      new Date('2026-04-29T09:00:00.000Z'),
    );

    for (const binding of bindings) {
      await adoptGitSourceBinding(
        transaction,
        {
          actorPrincipalId: 'prn_git_runtime',
          binding,
          organizationId: 'org_git_runtime',
          sourceId: source.id,
          watchPathsJson: '[]',
        },
        new Date('2026-04-29T09:00:00.000Z'),
      );
    }
  });
}

async function completeGitSourceSyncTaskForWorker(input: TestWorkerCompleteGitSourceSyncTaskRequest): Promise<void> {
  await completeGitSourceSyncTaskForWorkerService({
    ...input,
    claimToken: input.claimToken ?? (await claimSourceSyncTaskForTest(db, input.taskId, apiConfig.runtimeControlToken)),
  });
}

async function failGitSourceSyncTaskForWorker(input: TestWorkerFailGitSourceSyncTaskRequest): Promise<void> {
  await failGitSourceSyncTaskForWorkerService({
    ...input,
    claimToken: input.claimToken ?? (await claimSourceSyncTaskForTest(db, input.taskId, apiConfig.runtimeControlToken)),
  });
}

function createBinding(
  projectName: string,
  descriptorPath: string,
  branchName: string = 'main',
): GitSourceBindingInput {
  return {
    autoDeployEnabled: true,
    branchMapping: {
      branchName,
      environmentName: 'production',
    },
    descriptorPath,
    projectName,
  };
}

function createClaimTokenForTask(
  task: typeof sourceSyncTasks.$inferSelect,
  secret: string = apiConfig.runtimeControlToken,
): string {
  return createSourceSyncClaimToken({
    claimedAt: requirePresent(task.claimedAt, 'source sync claim timestamp'),
    claimedByWorkerId: requirePresent(task.claimedByWorkerId, 'source sync claim worker'),
    secret,
  });
}

function createPushPayload(input: CreatePushPayloadInput): GitHubPushPayload {
  return {
    after: input.commitSha,
    commits: [
      {
        added: [...input.changedPaths],
        modified: [],
        removed: [],
      },
    ],
    installation: {
      id: 501,
    },
    ref: `refs/heads/${input.branchName ?? 'main'}`,
    repository: {
      id: 101,
      name: 'mono',
      owner: {
        login: 'acme',
      },
    },
    size: input.size ?? 1,
  };
}

function createInstallationRepositoriesRemovedPayload(): GitHubWebhookObject {
  return {
    action: 'removed',
    installation: {
      id: 501,
    },
    repositories_removed: [
      {
        id: 101,
        name: 'mono',
        owner: {
          login: 'acme',
        },
      },
    ],
  };
}

function createWebhookInput(options: CreateWebhookInputOptions): HandleGitHubSourceWebhookInput {
  const rawBody: Buffer = Buffer.from(JSON.stringify(options.payload), 'utf8');

  return {
    body: options.payload,
    eventType: options.eventType,
    providerDeliveryId: options.providerDeliveryId,
    rawBody,
    registrationId: 'gpr_git_runtime',
    organizationId: 'org_git_runtime',
    signature: signGitHubWebhookBody(rawBody),
  };
}

function signGitHubWebhookBody(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
}

async function readBindingByProjectName(projectName: string): Promise<typeof sourceBindings.$inferSelect | undefined> {
  const rows: (typeof sourceBindings.$inferSelect)[] = await db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.projectName, projectName));

  return rows[0];
}

function readChangedFilesJson(value: string): string[] {
  const parsed: GitHubWebhookValue = JSON.parse(value) as GitHubWebhookValue;
  return Array.isArray(parsed)
    ? parsed.filter((entry: GitHubWebhookValue): entry is string => typeof entry === 'string')
    : [];
}

function requireFirst<T>(values: readonly T[], label: string): T {
  return requireValue(values[0], label);
}

function requirePresent<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to exist.`);
  }

  return value;
}

function readAuditEventTypes(events: readonly (typeof auditEvents.$inferSelect)[]): string[] {
  return events.map((event: typeof auditEvents.$inferSelect): string => event.eventType);
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist.`);
  }

  return value;
}
