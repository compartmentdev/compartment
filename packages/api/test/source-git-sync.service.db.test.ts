import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import { describe, expect, it } from 'vitest';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  gitProviderRegistrations,
  organizations,
  principals,
  sourceSyncTaskCandidates,
  sourceSyncTasks,
  sources,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  completeSourceSyncTask as completeSourceSyncTaskQuery,
  createSourceSyncTask,
  failSourceSyncTask as failSourceSyncTaskQuery,
  replaceSourceSyncTaskCandidates,
} from '../src/queries/source-sync.query';
import type { SourceMutationTransaction } from '../src/queries/source.query.types';
import type { CompleteSourceSyncTaskInput, FailSourceSyncTaskInput } from '../src/queries/source-sync.query.types';
import { persistConnectedGitSource } from '../src/services/git-source/git-source-connect.persistence';
import { readGitSourceSyncTask, startGitSourceSync } from '../src/services/git-source/git-source-sync.service';
import type { Actor } from '../src/services/auth-actor.types';
import type {
  GitSourceSyncContextInput,
  GitSourceSyncTaskView,
} from '../src/services/git-source/git-source-sync.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import { claimSourceSyncTaskForTest } from './source-sync-task-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'git_source_sync_service');
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
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  throttle: defaultApiAuthThrottleConfig,
  trustedOutboundHosts: [],
  tenantSecretsKek: parseVariablesMasterKey('33'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('33'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('git source sync service', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => {
      await createSyncScope();
    },
  });

  it('reuses the latest pending task for the same source', async (): Promise<void> => {
    const sourceId: string = await connectSyncSource();

    const firstTask: GitSourceSyncTaskView = await startGitSourceSync(createSyncContext(sourceId));
    const secondTask: GitSourceSyncTaskView = await startGitSourceSync(createSyncContext(sourceId));
    const storedTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      await db.select().from(sourceSyncTasks),
      'source sync task',
    );

    expect(firstTask.id).toBe(secondTask.id);
    expect(await db.select().from(sourceSyncTasks)).toHaveLength(1);
    expect(storedTask.requestedByPrincipalId).toBe('prn_git_sync');
  });

  it('reuses a live automation task without overwriting its provenance', async (): Promise<void> => {
    const sourceId: string = await connectSyncSource();

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: 'sst_push_pending',
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_sync_auto',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:15:00.000Z'),
      });
    });

    const task: GitSourceSyncTaskView = await startGitSourceSync(createSyncContext(sourceId));
    const storedTask: typeof sourceSyncTasks.$inferSelect = requireFirst(
      await db.select().from(sourceSyncTasks).where(eq(sourceSyncTasks.id, task.id)),
      'automation source sync task',
    );

    expect(task.id).toBe('sst_push_pending');
    expect(storedTask).toMatchObject({
      requestedByPrincipalId: 'prn_git_sync_auto',
      requestedDescriptorPathsJson: '[]',
      status: 'pending',
    });
  });

  it('creates a fresh pending task after the latest completed sync', async (): Promise<void> => {
    const sourceId: string = await connectSyncSource();
    const completedTaskId: string = 'sst_completed';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: completedTaskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_sync',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'pending',
        updatedAt: new Date('2026-04-29T10:30:00.000Z'),
      });
      await replaceSourceSyncTaskCandidates(transaction, completedTaskId, [
        {
          blockedReason: null,
          derivedWatchPathsJson: '["apps/web"]',
          descriptorDirectory: 'apps/web',
          descriptorPath: 'apps/web/compartment.yml',
          id: 'ssc_completed',
          projectName: 'web',
          sourceSyncTaskId: completedTaskId,
          status: 'accepted',
          updatedAt: new Date('2026-04-29T10:31:00.000Z'),
        },
      ]);
      await completeSourceSyncTask(transaction, {
        completedAt: new Date('2026-04-29T10:32:00.000Z'),
        id: completedTaskId,
        resolvedCommitSha: 'sha_sync_completed',
        updatedAt: new Date('2026-04-29T10:32:00.000Z'),
      });
    });

    const rerunTask: GitSourceSyncTaskView = await startGitSourceSync(createSyncContext(sourceId));
    const storedTasks: (typeof sourceSyncTasks.$inferSelect)[] = await db.select().from(sourceSyncTasks);

    expect(rerunTask.id).not.toBe(completedTaskId);
    expect(rerunTask.status).toBe('pending');
    expect(storedTasks).toHaveLength(2);
  });

  it('resets a failed task in place and clears stale candidates before retrying', async (): Promise<void> => {
    const sourceId: string = await connectSyncSource();
    const context: GitSourceSyncContextInput = createSyncContext(sourceId);
    const firstTask: GitSourceSyncTaskView = await startGitSourceSync(context);

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await replaceSourceSyncTaskCandidates(transaction, firstTask.id, [
        {
          blockedReason: 'stale conflict',
          derivedWatchPathsJson: '["apps/stale"]',
          descriptorDirectory: 'apps/stale',
          descriptorPath: 'apps/stale/compartment.yml',
          id: 'ssc_stale',
          projectName: 'stale-web',
          sourceSyncTaskId: firstTask.id,
          status: 'blocked',
          updatedAt: new Date('2026-04-29T11:05:00.000Z'),
        },
      ]);
      await failSourceSyncTask(transaction, {
        completedAt: new Date('2026-04-29T11:06:00.000Z'),
        failureReason: 'stale failure',
        id: firstTask.id,
        updatedAt: new Date('2026-04-29T11:06:00.000Z'),
      });
    });

    const retriedTask: GitSourceSyncTaskView = await startGitSourceSync(context);

    expect(retriedTask.id).toBe(firstTask.id);
    expect(retriedTask.status).toBe('pending');
    expect(retriedTask.candidates).toEqual([]);
    expect(await db.select().from(sourceSyncTaskCandidates)).toEqual([]);
  });

  it('reads completed sync tasks with terminal accepted and blocked candidates', async (): Promise<void> => {
    const sourceId: string = await connectSyncSource();
    const taskId: string = 'sst_completed_terminal';

    await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
      await createSourceSyncTask(transaction, {
        adoptionMode: 'incremental',
        id: taskId,
        maxAttempts: 5,
        requestedByPrincipalId: 'prn_git_sync',
        requestedBranchName: 'main',
        requestedDescriptorPathsJson: '[]',
        sourceId,
        status: 'pending',
        updatedAt: new Date('2026-04-29T12:00:00.000Z'),
      });
      await replaceSourceSyncTaskCandidates(transaction, taskId, [
        {
          blockedReason: null,
          derivedWatchPathsJson: '["apps/web"]',
          descriptorDirectory: 'apps/web',
          descriptorPath: 'apps/web/compartment.yml',
          id: 'ssc_accept',
          projectName: 'web',
          sourceSyncTaskId: taskId,
          status: 'accepted',
          updatedAt: new Date('2026-04-29T12:01:00.000Z'),
        },
        {
          blockedReason: 'Project "billing" already has an active Git binding.',
          derivedWatchPathsJson: '[]',
          descriptorDirectory: 'apps/billing',
          descriptorPath: 'apps/billing/compartment.yml',
          id: 'ssc_block',
          projectName: null,
          sourceSyncTaskId: taskId,
          status: 'blocked',
          updatedAt: new Date('2026-04-29T12:01:00.000Z'),
        },
      ]);
      await completeSourceSyncTask(transaction, {
        completedAt: new Date('2026-04-29T12:02:00.000Z'),
        id: taskId,
        resolvedCommitSha: 'sha_sync_accept',
        updatedAt: new Date('2026-04-29T12:02:00.000Z'),
      });
    });

    const task: GitSourceSyncTaskView = await readGitSourceSyncTask({
      ...createSyncContext(sourceId),
      taskId,
    });

    expect(task).toMatchObject({
      id: taskId,
      resolvedCommitSha: 'sha_sync_accept',
      status: 'completed',
    });
    expect(task.candidates).toEqual([
      expect.objectContaining({
        blockedReason: null,
        descriptorPath: 'apps/web/compartment.yml',
        id: 'ssc_accept',
        status: 'accepted',
      }),
      expect.objectContaining({
        blockedReason: 'Project "billing" already has an active Git binding.',
        descriptorPath: 'apps/billing/compartment.yml',
        id: 'ssc_block',
        projectName: null,
        status: 'blocked',
      }),
    ]);
  });
});

async function createSyncScope(): Promise<void> {
  await db.insert(principals).values([
    {
      email: 'git-sync@example.com',
      id: 'prn_git_sync',
      type: 'user',
    },
    {
      email: 'git-sync-automation@example.com',
      id: 'prn_git_sync_auto',
      type: 'automation',
    },
  ]);
  await db.insert(organizations).values({
    id: 'org_git_sync',
    name: 'Git Sync Org',
    slug: 'git-sync-org',
  });
  await db.insert(gitProviderRegistrations).values({
    appId: 'app_sync',
    appName: 'Compartment GitHub App',
    appSlug: 'compartment-github-app',
    appUrl: 'https://github.com/apps/compartment-github-app',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdByPrincipalId: 'prn_git_sync',
    id: 'gpr_git_sync',
    organizationId: 'org_git_sync',
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
      'https://console.example/v1/sources/git/providers/github/organizations/org_git_sync/registrations/gpr_git_sync/webhook',
  });
}

async function connectSyncSource(): Promise<string> {
  await db.transaction(async (transaction: SourceMutationTransaction): Promise<void> => {
    await persistConnectedGitSource(
      transaction,
      {
        actorPrincipalId: 'prn_git_sync',
        installationId: '501',
        organizationId: 'org_git_sync',
        providerHost: 'github.com',
        providerRegistrationId: 'gpr_git_sync',
        repository: {
          defaultBranchName: 'main',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryExternalId: '101',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
        },
        request: {
          autoAdoptNewApps: true,
          defaultAutoDeployEnabled: true,
          defaultEnvironmentName: 'production',
          providerHost: 'github.com',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          syncBranchName: 'main',
        },
        syncBranchName: 'main',
      },
      new Date('2026-04-29T10:00:00.000Z'),
    );
  });

  return requireFirst(await db.select().from(sources), 'source').id;
}

async function completeSourceSyncTask(
  transaction: SourceMutationTransaction,
  input: Omit<CompleteSourceSyncTaskInput, 'claimToken'>,
): Promise<void> {
  await completeSourceSyncTaskQuery(transaction, {
    ...input,
    claimToken: await claimSourceSyncTaskForTest(transaction, input.id, apiConfig.runtimeControlToken),
  });
}

async function failSourceSyncTask(
  transaction: SourceMutationTransaction,
  input: Omit<FailSourceSyncTaskInput, 'claimToken'>,
): Promise<void> {
  await failSourceSyncTaskQuery(transaction, {
    ...input,
    claimToken: await claimSourceSyncTaskForTest(transaction, input.id, apiConfig.runtimeControlToken),
  });
}

function createSyncContext(sourceId: string): { actor: Actor; organizationId: string; sourceId: string } {
  return {
    actor: createActor(),
    organizationId: 'org_git_sync',
    sourceId,
  };
}

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    memberships: [
      {
        role: 'admin',
        scopeId: 'org_git_sync',
        scopeType: 'organization',
      },
    ],
    principalEmail: 'git-sync@example.com',
    principalId: 'prn_git_sync',
    principalType: 'user',
    sessionId: 'ses_git_sync',
    tokenHash: 'tok_git_sync',
  };
}

function requireFirst<T>(values: readonly T[], label: string): T {
  const value: T | undefined = values[0];
  if (value === undefined) {
    throw new Error(`Expected ${label} to exist.`);
  }

  return value;
}
