import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type {
  ProductJobIntent,
  ResourceOperationProductJobIntent,
  ResourceReconcileIntent,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentRuns,
  deployments,
  environmentResourceOutputVariableBindings,
  environments,
  operations,
  organizations,
  jobUsageHourly,
  productJobRuns,
  projectKubeProvisioning,
  projectResources,
  projectServices,
  projects,
  resourceReconcileRuns,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  claimProductJob,
  persistProductJobFinalized,
  readProductJobResult,
} from '../src/queries/product-job-runs.query';
import { persistProductJobResult } from '../src/queries/product-job-result.query';
import { persistProductJobIntent } from '../src/queries/product-job-intent.query';
import { expireProductJobWait, readProductJobQueueWaitState } from '../src/queries/product-job-wait.query';
import type { ProductJobQueueWaitState } from '../src/queries/product-job-wait.query.types';
import type { ClaimedProductJobQueryResult } from '../src/queries/product-job-runs.query.types';
import { createResourceReconcileRun } from '../src/queries/resource-reconcile-create.query';
import { finalizeProjectResourceDeletion } from '../src/queries/resource-reconcile-deletion.query';
import { readResourceReconcileRunWaitState } from '../src/queries/resource-reconcile-wait.query';
import type { ResourceReconcileRunWaitState } from '../src/queries/resource-reconcile-runs.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'product_job_runs');
const apiConfig: ApiConfig = buildApiConfig(databaseUrl);
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

interface TerminalReleaseResourceTestCase {
  phase: 'failed' | 'reconcile-pending';
  resourceStatus: 'deleting' | 'running';
}

describe('product Job persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  beforeEach(async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org_job', name: 'Product Jobs', slug: 'product-jobs' });
    await db.insert(projects).values({ id: 'prj-job', name: 'jobs', organizationId: 'org_job' });
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj-job', state: 'succeeded' });
    await db.insert(environments).values({ id: 'env-job', name: 'production', projectId: 'prj-job' });
    await db
      .insert(projectServices)
      .values({ id: 'svc-job', kind: 'web', name: 'web', path: '.', projectId: 'prj-job' });
    await db.insert(operations).values({
      id: 'op-job',
      status: 'running',
      summary: 'Deploy',
      targetId: 'dep_job',
      targetType: 'deployment',
      type: 'deployment.create',
    });
    await db.insert(buildArtifacts).values({
      id: 'bar-job',
      imageRef: 'registry.example/release@sha256:abc',
      imageRepository: 'registry.example/release',
      projectId: 'prj-job',
      projectServiceId: 'svc-job',
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'sha256:job',
    });
    await db.insert(deploymentRuns).values({ environmentId: 'env-job', id: 'drn-job', triggerType: 'manual' });
    await db.insert(deployments).values({
      buildArtifactId: 'bar-job',
      deploymentRunId: 'drn-job',
      environmentId: 'env-job',
      health: 'pending',
      id: 'dep_job',
      operationId: 'op-job',
      projectServiceId: 'svc-job',
      promotionStage: 'release',
      resolvedPortsJson: '[3000]',
      resolvedReadinessJson: '[]',
      resolvedRunJson: '{}',
      status: 'running',
    });
    await db.insert(projectResources).values({
      commandJson: '[]',
      envJson: '[]',
      environmentId: 'env-job',
      id: 'res-db',
      image: 'postgres:17',
      name: 'postgres',
      portsJson: '[5432]',
      readinessJson: 'null',
      runtimeDefinitionHash: 'runtime-hash',
      status: 'running',
      volumesJson: '[]',
    });
  });

  it('converges duplicate intent and result delivery into one durable full-log row', async (): Promise<void> => {
    const intent: ProductJobIntent = releaseIntent();
    await persistProductJobIntent({ identityId: 'dep_job', intent });
    await persistProductJobIntent({ identityId: 'dep_job', intent });

    const initialClaim: ClaimedProductJobQueryResult = await claimProductJob('release');
    expect(initialClaim.intent).toMatchObject({
      deploymentId: 'dep_job',
      imagePullSecretId: 'pull-project',
      jobClass: 'release',
    });
    expect(initialClaim.persistedResult).toBeNull();
    const [claimedRow] = await db
      .select({ startedAt: productJobRuns.startedAt })
      .from(productJobRuns)
      .where(eq(productJobRuns.identityId, 'dep_job'));
    expect(claimedRow?.startedAt).toBeInstanceOf(Date);
    await db
      .update(productJobRuns)
      .set({ startedAt: new Date('2026-07-12T11:59:00.000Z') })
      .where(eq(productJobRuns.identityId, 'dep_job'));
    const terminalResult: WorkerPersistProductJobResultRequest = {
      completedAt: '2026-07-12T12:00:00.000Z',
      exitCode: null,
      identityId: 'dep_job',
      jobClass: 'release',
      jobName: 'cpt-job-dep-job',
      logs: 'first line\nlast line\n',
      podName: null,
      status: 'timed-out',
    };
    await persistProductJobResult(terminalResult);
    await persistProductJobResult(terminalResult);
    await persistProductJobResult({ ...terminalResult, exitCode: 0, logs: 'conflicting', status: 'succeeded' });

    const rows: object[] = await db.select().from(productJobRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exitCode: null,
      logs: 'first line\nlast line\n',
      podName: null,
      status: 'timed-out',
    });
    expect(await db.select().from(jobUsageHourly)).toMatchObject([{ durationSeconds: 60, jobCount: 1 }]);
    const cleanupClaim: ClaimedProductJobQueryResult = await claimProductJob('release');
    expect(cleanupClaim.intent).toMatchObject({ deploymentId: 'dep_job', jobClass: 'release' });
    expect(cleanupClaim.persistedResult).toEqual(terminalResult);
    await persistProductJobFinalized('release', 'dep_job');
    expect(await claimProductJob('release')).toEqual({ intent: null, persistedResult: null });
  });

  it('keeps a claimed Job running and reclaimable until terminal evidence is persisted', async (): Promise<void> => {
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job' },
      persistedResult: null,
    });

    const [running] = await db
      .select({
        completedAt: productJobRuns.completedAt,
        exitCode: productJobRuns.exitCode,
        jobName: productJobRuns.jobName,
        logs: productJobRuns.logs,
        podName: productJobRuns.podName,
        status: productJobRuns.status,
      })
      .from(productJobRuns)
      .where(eq(productJobRuns.identityId, 'dep_job'));
    expect(running).toEqual({
      completedAt: null,
      exitCode: null,
      jobName: null,
      logs: null,
      podName: null,
      status: 'running',
    });
    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job' },
      persistedResult: null,
    });
  });

  it('claims a release immediately when the descriptor declares no resources', async (): Promise<void> => {
    await db.delete(projectResources).where(eq(projectResources.id, 'res-db'));
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job', jobClass: 'release' },
      persistedResult: null,
    });
  });

  it('claims a release immediately when an unbound environment resource is stopped', async (): Promise<void> => {
    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res-db'));
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job', jobClass: 'release' },
      persistedResult: null,
    });
  });

  it('keeps a release queued when a descriptor resource binding exists before its resource row', async (): Promise<void> => {
    await db.delete(projectResources).where(eq(projectResources.id, 'res-db'));
    await db.insert(environmentResourceOutputVariableBindings).values({
      environmentId: 'env-job',
      id: 'binding-db',
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'postgres',
      source: 'descriptor',
      targetServiceName: 'web',
    });
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toEqual({ intent: null, persistedResult: null });
  });

  it('keeps a cold-start release queued until its descriptor resource bootstrap succeeds', async (): Promise<void> => {
    await db.insert(environmentResourceOutputVariableBindings).values({
      environmentId: 'env-job',
      id: 'binding-db',
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'postgres',
      source: 'descriptor',
      targetServiceName: 'web',
    });
    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res-db'));
    await db.insert(resourceReconcileRuns).values({
      expectedClaimsJson: '[]',
      id: 'rrun-db',
      intentJson: '{}',
      operationType: 'bootstrap',
      phase: 'bootstrap-pending',
      projectResourceId: 'res-db',
    });
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toEqual({ intent: null, persistedResult: null });

    await db.update(projectResources).set({ status: 'running' }).where(eq(projectResources.id, 'res-db'));
    await db.update(resourceReconcileRuns).set({ phase: 'succeeded' }).where(eq(resourceReconcileRuns.id, 'rrun-db'));
    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job', jobClass: 'release' },
      persistedResult: null,
    });
  });

  it('requeues a release until its descriptor-connected resource latest reconcile succeeds', async (): Promise<void> => {
    await db.insert(environmentResourceOutputVariableBindings).values({
      environmentId: 'env-job',
      id: 'binding-db',
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'postgres',
      source: 'descriptor',
      targetServiceName: 'web',
    });
    await db.insert(resourceReconcileRuns).values([
      {
        createdAt: new Date('2026-07-20T10:00:00.000Z'),
        expectedClaimsJson: '[]',
        id: 'rrun-db-old',
        intentJson: '{}',
        operationType: 'bootstrap',
        phase: 'failed',
        projectResourceId: 'res-db',
      },
      {
        createdAt: new Date('2026-07-20T11:00:00.000Z'),
        expectedClaimsJson: '[]',
        id: 'rrun-db',
        intentJson: '{}',
        operationType: 'reconcile',
        phase: 'reconcile-pending',
        projectResourceId: 'res-db',
      },
    ]);
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(claimProductJob('release')).resolves.toEqual({ intent: null, persistedResult: null });
    await expect(claimProductJob('release')).resolves.toEqual({ intent: null, persistedResult: null });

    await db.update(resourceReconcileRuns).set({ phase: 'succeeded' }).where(eq(resourceReconcileRuns.id, 'rrun-db'));
    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job', jobClass: 'release' },
      persistedResult: null,
    });
  });

  it.each([
    { phase: 'failed' as const, resourceStatus: 'running' as const },
    { phase: 'reconcile-pending' as const, resourceStatus: 'deleting' as const },
  ])(
    'fails a release immediately when its descriptor-connected resource is terminal ($resourceStatus/$phase)',
    async ({ phase, resourceStatus }: TerminalReleaseResourceTestCase): Promise<void> => {
      await db.insert(environmentResourceOutputVariableBindings).values({
        environmentId: 'env-job',
        id: 'binding-db',
        keyName: 'DATABASE_URL',
        outputName: 'connection-url',
        resourceName: 'postgres',
        source: 'descriptor',
        targetServiceName: 'web',
      });
      await db.update(projectResources).set({ status: resourceStatus }).where(eq(projectResources.id, 'res-db'));
      await db.insert(resourceReconcileRuns).values({
        expectedClaimsJson: '[]',
        id: 'rrun-db',
        intentJson: '{}',
        operationType: 'reconcile',
        phase,
        projectResourceId: 'res-db',
      });
      await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

      await expect(claimProductJob('release')).resolves.toMatchObject({
        intent: { deploymentId: 'dep_job', jobClass: 'release' },
        persistedResult: {
          identityId: 'dep_job',
          jobClass: 'release',
          status: 'failed',
        },
      });
    },
  );

  it('fails a release immediately when its descriptor-connected resource was deleted', async (): Promise<void> => {
    await db.insert(environmentResourceOutputVariableBindings).values({
      environmentId: 'env-job',
      id: 'binding-db',
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'postgres',
      source: 'descriptor',
      targetServiceName: 'web',
    });
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });
    await db.update(projectResources).set({ status: 'deleting' }).where(eq(projectResources.id, 'res-db'));
    await expect(finalizeProjectResourceDeletion('res-db')).resolves.toEqual({
      deleteData: false,
      finalized: true,
    });

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job', jobClass: 'release' },
      persistedResult: { identityId: 'dep_job', jobClass: 'release', status: 'failed' },
    });
  });

  it('times out a release that remains queued behind a declared resource', async (): Promise<void> => {
    await db.insert(environmentResourceOutputVariableBindings).values({
      environmentId: 'env-job',
      id: 'binding-db',
      keyName: 'DATABASE_URL',
      outputName: 'connection-url',
      resourceName: 'postgres',
      source: 'descriptor',
      targetServiceName: 'web',
    });
    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res-db'));
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });
    await db
      .update(productJobRuns)
      .set({ createdAt: new Date(Date.now() - 31_000) })
      .where(eq(productJobRuns.identityId, 'dep_job'));

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_job' },
      persistedResult: { status: 'timed-out' },
    });
  });

  it('persists resource-operation PVC mounts across claim and recovery', async (): Promise<void> => {
    const intent: ProductJobIntent = {
      command: ['sh', '-c', 'pg_dump'],
      env: {
        COMPARTMENT_BACKUP_DIR: {
          encryptionKeyId: 'tenant-kek-sha256:test',
          valueCiphertext: '{"version":1}',
        },
      },
      image: 'postgres@sha256:abc',
      jobClass: 'resource-operation',
      namespace: 'cpt-project',
      operationId: 'op_backup',
      projectId: 'prj-job',
      resourceIds: ['res-db'],
      runtimeIdentity: 'resource',
      timeoutMs: 30_000,
      volumeMounts: [
        {
          claimName: 'backup-artifacts',
          expectedClaimUid: 'uid-backup',
          mountPath: '/backup',
          name: 'backup',
          resourceId: 'res-db',
          subPath: 'rbak_test',
        },
      ],
    };
    await persistProductJobIntent({ identityId: 'op_backup', intent });

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { runtimeIdentity: 'resource', volumeMounts: intent.volumeMounts },
    });
  });

  it('persists the project runtime identity for platform resource operations', async (): Promise<void> => {
    const intent: ProductJobIntent = {
      ...resourceOperationIntent('op_platform'),
      runtimeIdentity: 'project',
    };
    await persistProductJobIntent({ identityId: 'op_platform', intent });

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'op_platform', runtimeIdentity: 'project' },
    });
  });

  it('starts the execution deadline when a queued resource operation is claimed', async (): Promise<void> => {
    const intent: ProductJobIntent = resourceOperationIntent();
    await persistProductJobIntent({ identityId: 'op_backup', intent });
    await db
      .update(productJobRuns)
      .set({ createdAt: new Date(Date.now() - 600_000) })
      .where(eq(productJobRuns.identityId, 'op_backup'));

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'op_backup', timeoutMs: 30_000 },
    });
  });

  it('keeps release recovery out of the independent resource-operation lane', async (): Promise<void> => {
    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });
    await persistProductJobIntent({ identityId: 'op_backup', intent: resourceOperationIntent() });

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { jobClass: 'resource-operation', operationId: 'op_backup' },
    });
  });

  it('does not start overlapping resource operations while one is running', async (): Promise<void> => {
    await persistProductJobIntent({ identityId: 'op_running', intent: resourceOperationIntent('op_running') });
    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'op_running' },
    });
    await db
      .update(productJobRuns)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(productJobRuns.identityId, 'op_running'));
    await persistProductJobIntent({ identityId: 'op_waiting', intent: resourceOperationIntent('op_waiting') });

    await expect(claimProductJob('resource-operation')).resolves.toEqual({ intent: null, persistedResult: null });
  });

  it('bounds queued resource work by predecessor execution budgets and persists queue expiry', async (): Promise<void> => {
    await persistProductJobIntent({ identityId: 'op_first', intent: resourceOperationIntent('op_first') });
    await persistProductJobIntent({ identityId: 'op_waiting', intent: resourceOperationIntent('op_waiting') });

    await expect(readProductJobQueueWaitState('resource-operation', 'op_waiting')).resolves.toMatchObject({
      queueBudgetMs: 60_000,
    });
    await persistProductJobResult({
      completedAt: '2026-07-16T02:00:00.000Z',
      exitCode: 0,
      identityId: 'op_first',
      jobClass: 'resource-operation',
      jobName: 'job-first',
      logs: 'done',
      podName: 'pod-first',
      status: 'succeeded',
    });
    await persistProductJobFinalized('resource-operation', 'op_first');
    await expect(readProductJobQueueWaitState('resource-operation', 'op_waiting')).resolves.toMatchObject({
      queueBudgetMs: 30_000,
    });

    await expect(
      expireProductJobWait({
        completedAt: '2026-07-16T02:30:00.000Z',
        exitCode: null,
        identityId: 'op_waiting',
        jobClass: 'resource-operation',
        jobName: 'queue-timeout/op_waiting',
        logs: 'queue timeout',
        podName: null,
        status: 'timed-out',
      }),
    ).resolves.toMatchObject({ identityId: 'op_waiting', status: 'timed-out' });
  });

  it('includes an older reconcile in the product Job queue budget', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceReconcileIntent(),
      operationId: 'rr_before_product_job_wait',
      type: 'reconcile',
    });
    await persistProductJobIntent({
      identityId: 'job_waits_for_reconcile_budget',
      intent: resourceOperationIntent('job_waits_for_reconcile_budget'),
    });

    const state: ProductJobQueueWaitState | null = await readProductJobQueueWaitState(
      'resource-operation',
      'job_waits_for_reconcile_budget',
    );
    expect(state?.queueBudgetMs).toBeGreaterThan(30_000);
  });

  it('includes an older product Job in the reconcile wait budget and token', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'job_before_reconcile_wait',
      intent: resourceOperationIntent('job_before_reconcile_wait'),
    });
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceReconcileIntent(),
      operationId: 'rr_waits_for_product_job_budget',
      type: 'reconcile',
    });

    const blocked: ResourceReconcileRunWaitState | null = await readResourceReconcileRunWaitState(
      'rr_waits_for_product_job_budget',
    );
    expect(blocked).toMatchObject({
      predecessorProductJobCount: 1,
      predecessorProductJobTimeoutMs: 30_000,
    });
    await persistProductJobResult({
      completedAt: '2026-07-16T04:00:00.000Z',
      exitCode: 0,
      identityId: 'job_before_reconcile_wait',
      jobClass: 'resource-operation',
      jobName: 'job-before-reconcile-wait',
      logs: 'done',
      podName: 'pod-before-reconcile-wait',
      status: 'succeeded',
    });
    await persistProductJobFinalized('resource-operation', 'job_before_reconcile_wait');
    const unblocked: ResourceReconcileRunWaitState | null = await readResourceReconcileRunWaitState(
      'rr_waits_for_product_job_budget',
    );
    expect(unblocked?.predecessorProductJobCount).toBe(0);
    expect(unblocked?.predecessorToken).not.toBe(blocked?.predecessorToken);
  });

  it('claims equal-timestamp product Jobs in the same id order used by queue budgets', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'op_inserted_first',
      intent: resourceOperationIntent('op_inserted_first'),
    });
    await persistProductJobIntent({ identityId: 'op_lower_id', intent: resourceOperationIntent('op_lower_id') });
    const tiedCreatedAt: Date = new Date('2026-07-16T03:00:00.000Z');
    await db
      .update(productJobRuns)
      .set({ createdAt: tiedCreatedAt, id: 'job_z' })
      .where(eq(productJobRuns.identityId, 'op_inserted_first'));
    await db
      .update(productJobRuns)
      .set({ createdAt: tiedCreatedAt, id: 'job_a' })
      .where(eq(productJobRuns.identityId, 'op_lower_id'));

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'op_lower_id' },
    });
  });

  it('returns terminal cancellation instead of queueing release work for an archived project', async (): Promise<void> => {
    await db
      .update(projects)
      .set({ archivedAt: new Date('2026-07-15T12:00:00.000Z') })
      .where(eq(projects.id, 'prj-job'));

    await persistProductJobIntent({ identityId: 'dep_job', intent: releaseIntent() });

    await expect(readProductJobResult('release', 'dep_job')).resolves.toMatchObject({
      identityId: 'dep_job',
      status: 'timed-out',
    });
    const canceled: ClaimedProductJobQueryResult = await claimProductJob('release');
    expect(canceled.intent?.jobClass).toBe('release');
    expect(canceled.persistedResult?.status).toBe('timed-out');
  });
});

function releaseIntent(): ProductJobIntent {
  return {
    command: ['bin/release'],
    deploymentId: 'dep_job',
    env: {
      RELEASE: { encryptionKeyId: 'tenant-kek-sha256:test', valueCiphertext: '{"version":1}' },
    },
    image: 'registry.example/release@sha256:abc',
    imagePullSecretId: 'pull-project',
    jobClass: 'release',
    namespace: 'cpt-prj-job',
    projectId: 'prj-job',
    timeoutMs: 30_000,
  };
}

function resourceOperationIntent(operationId: string = 'op_backup'): ResourceOperationProductJobIntent {
  return {
    command: ['bin/backup'],
    env: {},
    image: 'postgres@sha256:abc',
    jobClass: 'resource-operation',
    namespace: 'cpt-prj-job',
    operationId,
    projectId: 'prj-job',
    resourceIds: ['res-db'],
    runtimeIdentity: 'resource',
    timeoutMs: 30_000,
  };
}

function resourceReconcileIntent(): ResourceReconcileIntent {
  return {
    command: [],
    deleteData: false,
    environmentId: 'env-job',
    env: {},
    image: 'postgres:17',
    namespaceId: 'prj-job',
    operation: 'reconcile',
    ports: [5432],
    readiness: null,
    replicas: 1,
    resourceId: 'res-db',
    secretId: 'res-db',
    volumes: [],
  };
}

function buildApiConfig(url: string): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1_000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
    usageMeteringIntervalMs: 60_000,
    usageRetentionDays: 400,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    tlsMode: 'internal',
    controlPlaneHost: 'compartment.localhost',
    databaseUrl: url,
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
    tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
