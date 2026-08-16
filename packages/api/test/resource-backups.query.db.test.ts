import { eq, sql } from 'drizzle-orm';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environments,
  operations,
  principals,
  projectResources,
  projectKubeProvisioning,
  projects,
  productJobRuns,
  resourceReconcileRuns,
} from '../src/db/schema';
import {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
  failResourceBackupWithExecutor,
  findResourceBackupById,
  listResourceBackups,
  markResourceBackupRetentionDeletedWithExecutor,
} from '../src/queries/resource-backups.query';
import { listScheduledResourceOperationCandidates } from '../src/queries/resource-operation-scheduler.query';
import { acquireResourceOperationLocks } from '../src/queries/resource-operation-lock.query';
import type { ResourceOperationLock } from '../src/queries/resource-operation-lock.query.types';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import {
  beginProjectResourceDeletion,
  findProjectResourceByName,
  lockProjectResourceByName,
  lockProjectResourceOperation,
  lockProjectResourceReconciliation,
  lockProjectResourceReferenceByName,
} from '../src/queries/resources.query';
import {
  createResourceReconcileRun,
  createResourceReconcileRunWithExecutor,
  updateActiveResourceBootstrapIntent,
} from '../src/queries/resource-reconcile-create.query';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
} from '../src/queries/resource-reconcile-runs.query';
import { readResourceReconcileRunWaitState } from '../src/queries/resource-reconcile-wait.query';
import { finalizeProjectResourceDeletion } from '../src/queries/resource-reconcile-deletion.query';
import { cancelResourceReconcileRunsForProjectArchive } from '../src/queries/resource-reconcile-project.query';
import { claimProductJob, persistProductJobFinalized } from '../src/queries/product-job-runs.query';
import type { ClaimedProductJobQueryResult } from '../src/queries/product-job-runs.query.types';
import { persistProductJobResult } from '../src/queries/product-job-result.query';
import { persistProductJobIntent } from '../src/queries/product-job-intent.query';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import { claimPendingProjectProvisioning } from '../src/queries/project-provisioning.query';
import { createOrGetProject } from '../src/queries/projects.query';
import type { ProductJobIntent, ResourceClaimIdentity, ResourceReconcileIntent } from '@compartment/contracts';
import type {
  ClaimedResourceReconcileRun,
  CreateResourceReconcileRunResult,
} from '../src/queries/resource-reconcile-runs.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import type { ProjectProvisioningClaimRow } from '../src/queries/project-provisioning.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { parseStoredResourceOperations } from '../src/services/resources.service.storage';
import { seedCurrentProjectProvisioning, useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { seedOrganizationWithReadyQuota } from './organization-quota-test.fixture';
import { createApiTestConfig } from './api-config-test.fixtures';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'resource_backups_query_db');
const apiConfig: ApiConfig = createApiTestConfig({
  databaseUrl,
});
const pool: Pool = createDatabasePool(databaseUrl);
const resourceOperationPool: Pool = new Pool({ connectionString: databaseUrl, max: 2 });
const db: Database = createDatabase(pool, resourceOperationPool);

const unclaimedJob: ClaimedProductJobQueryResult = { intent: null, persistedResult: null, resourceReadiness: [] };

describe('resource backup queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: seedResourceBackupScope,
  });

  afterAll(async (): Promise<void> => {
    await resourceOperationPool.end();
  });

  it('serializes session-level workflows for one resource without coupling different resources', async (): Promise<void> => {
    const first: ResourceOperationLock = await acquireResourceOperationLocks(['res_serialized']);
    let secondAcquired: boolean = false;
    const secondPromise: Promise<ResourceOperationLock> = acquireResourceOperationLocks(['res_serialized']).then(
      (lock: ResourceOperationLock): ResourceOperationLock => {
        secondAcquired = true;
        return lock;
      },
    );
    const independent: ResourceOperationLock = await acquireResourceOperationLocks(['res_independent']);
    await independent.release();
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 50));

    expect(secondAcquired).toBe(false);
    await first.release();
    const second: ResourceOperationLock = await secondPromise;
    expect(secondAcquired).toBe(true);
    await second.release();
  });

  it('does not let blocked resource-operation locks exhaust ordinary query capacity', async (): Promise<void> => {
    const first: ResourceOperationLock = await acquireResourceOperationLocks(['res_pool_capacity']);
    const waiterCount: number = pool.options.max - 1;
    const waiters: Promise<void>[] = Array.from({ length: waiterCount }, async (): Promise<void> => {
      const lock: ResourceOperationLock = await acquireResourceOperationLocks(['res_pool_capacity']);
      await lock.release();
    });
    let probe: Promise<QueryResult> | undefined;

    try {
      await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 100));
      probe = pool.query('select 1');
      await expect(querySettlesBefore(probe, 250)).resolves.toBe(true);
    } finally {
      await first.release();
      await Promise.all(waiters);
      await probe;
    }
  });

  it('retries a contended multi-resource set without retaining partial session locks', async (): Promise<void> => {
    const first: ResourceOperationLock = await acquireResourceOperationLocks(['res_lock_a', 'res_lock_shared']);
    let secondAcquired: boolean = false;
    const secondPromise: Promise<ResourceOperationLock> = acquireResourceOperationLocks([
      'res_lock_b',
      'res_lock_shared',
    ]).then((lock: ResourceOperationLock): ResourceOperationLock => {
      secondAcquired = true;
      return lock;
    });
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 50));

    const independent: ResourceOperationLock = await acquireResourceOperationLocks(['res_lock_independent']);
    expect(secondAcquired).toBe(false);
    await independent.release();
    await first.release();
    const second: ResourceOperationLock = await secondPromise;
    await second.release();
  });

  it('persists backup status transitions and manifest metadata', async (): Promise<void> => {
    const backup: ResourceBackupRow = await createResourceBackupWithExecutor(db, {
      createdByPrincipalId: 'prn_resource_backups',
      id: 'rbak_query_123',
      operationId: 'op_resource_backup',
      projectResourceId: 'res_postgres',
      purpose: 'manual',
      status: 'running',
    });

    expect(backup.status).toBe('running');

    const completed: ResourceBackupRow = await completeResourceBackupWithExecutor(db, {
      artifactLocation: '/tmp/compartment-test-resource-backups/rbak_query_123',
      backupId: backup.id,
      checksum: 'sha256:abc123',
      completedAt: new Date('2026-05-06T12:00:00.000Z'),
      manifestJson: '{"backupId":"rbak_query_123","status":"succeeded"}',
      resourceDefinitionJson: '{"image":"postgres:16"}',
      sizeBytes: 128,
      stderrSummary: '',
      stdoutSummary: 'dumped',
    });

    expect(completed).toMatchObject({
      artifactLocation: '/tmp/compartment-test-resource-backups/rbak_query_123',
      checksum: 'sha256:abc123',
      manifestJson: '{"backupId":"rbak_query_123","status":"succeeded"}',
      resourceDefinitionJson: '{"image":"postgres:16"}',
      sizeBytes: 128,
      status: 'succeeded',
      stdoutSummary: 'dumped',
    });
    const deleted: ResourceBackupRow = await markResourceBackupRetentionDeletedWithExecutor(db, {
      backupId: backup.id,
      retentionDeletedAt: new Date('2026-05-07T12:00:00.000Z'),
      retentionReason: 'retention keepLast=1',
    });

    expect(deleted).toMatchObject({
      artifactLocation: null,
      retentionReason: 'retention keepLast=1',
      status: 'deleted',
    });
    await expect(findResourceBackupById(backup.id)).resolves.toMatchObject({ status: 'deleted' });
    await expect(listResourceBackups('res_postgres')).resolves.toHaveLength(1);
  });

  it('persists failed backup summaries', async (): Promise<void> => {
    await createResourceBackupWithExecutor(db, {
      createdByPrincipalId: 'prn_resource_backups',
      id: 'rbak_failed_123',
      operationId: 'op_resource_backup',
      projectResourceId: 'res_postgres',
      purpose: 'pre_restore',
      status: 'running',
    });

    const failed: ResourceBackupRow = await failResourceBackupWithExecutor(db, {
      backupId: 'rbak_failed_123',
      completedAt: new Date('2026-05-06T12:00:00.000Z'),
      failureSummary: 'operation failed',
      stderrSummary: 'psql error',
      stdoutSummary: '',
    });

    expect(failed).toMatchObject({
      failureSummary: 'operation failed',
      purpose: 'pre_restore',
      status: 'failed',
      stderrSummary: 'psql error',
    });
  });

  it('normalizes migrated resources with no operation commands', async (): Promise<void> => {
    const resource: ProjectResourceRow | undefined = await findProjectResourceByName('env_production', 'postgres');

    expect(resource).not.toBeUndefined();
    expect(parseStoredResourceOperations(resource!)).toEqual({
      backup: null,
      restore: null,
    });
  });

  it('lists only resources with scheduled backup operations as scheduler candidates', async (): Promise<void> => {
    await expect(listScheduledResourceOperationCandidates()).resolves.toEqual([]);

    await db
      .update(projectResources)
      .set({
        operationsJson:
          '{"backup":{"command":"pg_dump","env":[],"image":null,"schedule":{"interval":"daily"}},"restore":null}',
      })
      .where(eq(projectResources.id, 'res_postgres'));

    await expect(listScheduledResourceOperationCandidates()).resolves.toMatchObject([
      {
        resource: {
          id: 'res_postgres',
          name: 'postgres',
        },
      },
    ]);

    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res_postgres'));

    await expect(listScheduledResourceOperationCandidates()).resolves.toEqual([]);
  });

  it('locks resource references without blocking backup foreign key inserts', async (): Promise<void> => {
    await db.transaction(async (tx: ResourceTransaction): Promise<void> => {
      const resource: ProjectResourceRow | undefined = await lockProjectResourceReferenceByName(
        tx,
        'env_production',
        'postgres',
      );

      expect(resource).toMatchObject({ id: 'res_postgres', name: 'postgres' });
      expect(resource?.createdAt).toBeInstanceOf(Date);
      expect(resource?.updatedAt).toBeInstanceOf(Date);

      const backup: ResourceBackupRow = await db.transaction(
        async (insertTx: ResourceTransaction): Promise<ResourceBackupRow> => {
          await insertTx.execute(sql`set local lock_timeout = '250ms'`);
          return await createResourceBackupWithExecutor(insertTx, {
            createdByPrincipalId: 'prn_resource_backups',
            id: 'rbak_reference_lock_123',
            operationId: 'op_resource_backup',
            projectResourceId: 'res_postgres',
            purpose: 'manual',
            status: 'running',
          });
        },
      );

      expect(backup).toMatchObject({
        id: 'rbak_reference_lock_123',
        projectResourceId: 'res_postgres',
        status: 'running',
      });
    });
  });

  it('locks the project before the resource during descriptor reconciliation', async (): Promise<void> => {
    const holder: PoolClient = await pool.connect();
    let releaseReconciliation: (() => void) | undefined;
    let reconciliation: Promise<void> | null = null;
    try {
      await holder.query('begin');
      await holder.query("select id from projects where id = 'prj_internal_tools' for update");
      reconciliation = db.transaction(async (tx: ResourceTransaction): Promise<void> => {
        await lockProjectResourceReconciliation(tx, 'env_production', 'postgres');
        await lockProjectResourceByName(tx, 'env_production', 'postgres');
        await new Promise<void>((resolve: () => void): void => {
          releaseReconciliation = resolve;
        });
      });

      await waitForDatabaseLock(holder, 'transactionid');
      await expect(
        holder.query("select id from project_resources where id = 'res_postgres' for update nowait"),
      ).resolves.toMatchObject({ rowCount: 1 });
      await holder.query('commit');
      await waitForCondition((): boolean => releaseReconciliation !== undefined);
      releaseReconciliation?.();
      await reconciliation;
    } finally {
      releaseReconciliation?.();
      await holder.query('rollback');
      await Promise.allSettled(reconciliation === null ? [] : [reconciliation]);
      holder.release();
    }
  });

  it('lets an existing reconcile settle while a resource operation holds its reference fence', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_during_resource_operation',
      type: 'reconcile',
    });
    let releaseOperation: (() => void) | undefined;
    const operation: Promise<void> = db.transaction(async (tx: ResourceTransaction): Promise<void> => {
      await lockProjectResourceOperation(tx, 'env_production', 'postgres');
      await lockProjectResourceReferenceByName(tx, 'env_production', 'postgres');
      await new Promise<void>((resolve: () => void): void => {
        releaseOperation = resolve;
      });
    });
    await waitForCondition((): boolean => releaseOperation !== undefined);

    await expect(claimResourceReconcileRun()).resolves.toMatchObject({
      operationId: 'rr_during_resource_operation',
    });

    releaseOperation?.();
    await operation;
  });

  it('leases explicit bootstrap, persists canonical UIDs, and recovers only stale work', async (): Promise<void> => {
    const intent: ResourceReconcileIntent = resourceIntent();
    await createResourceReconcileRun({ expectedClaims: [], intent, operationId: 'rr_bootstrap', type: 'bootstrap' });
    const bootstrap: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(bootstrap).toMatchObject({ operationId: 'rr_bootstrap', type: 'bootstrap' });
    expect(bootstrap).not.toBeNull();
    const [leasedBootstrap] = await db
      .select({ leaseExpiresAt: resourceReconcileRuns.leaseExpiresAt })
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, 'rr_bootstrap'));
    expect((leasedBootstrap?.leaseExpiresAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan(7 * 60_000);
    expect(await claimResourceReconcileRun()).toBeNull();
    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      leaseId: bootstrap!.leaseId,
      operationId: 'rr_bootstrap',
      status: 'succeeded',
    });
    const [resource] = await db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres'));
    expect(resource?.expectedClaimsJson).toBe('[{"claimName":"claim-data","uid":"uid-original"}]');

    const ordinary: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(ordinary).toMatchObject({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      type: 'reconcile',
    });
    await db
      .update(resourceReconcileRuns)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(resourceReconcileRuns.id, ordinary!.operationId));
    const recovered: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(recovered?.leaseId).not.toBe(ordinary?.leaseId);
    expect(recovered?.operationId).toBe(ordinary?.operationId);
    await expect(
      acknowledgeResourceReconcileRun({
        leaseId: ordinary!.leaseId,
        operationId: ordinary!.operationId,
        status: 'succeeded',
      }),
    ).resolves.toBe(false);
    const [stillRunning] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, ordinary!.operationId));
    expect(stillRunning?.phase).toBe('running');
    await expect(
      acknowledgeResourceReconcileRun({
        leaseId: recovered!.leaseId,
        operationId: recovered!.operationId,
        status: 'running',
      }),
    ).resolves.toBe(true);
    const [renewed] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, recovered!.operationId));
    expect(renewed?.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    await acknowledgeResourceReconcileRun({
      leaseId: recovered!.leaseId,
      operationId: recovered!.operationId,
      status: 'succeeded',
    });
    const [runningResource] = await db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres'));
    expect(runningResource?.status).toBe('running');
  });

  it('distinguishes bootstrap startup from an explicit stop when queuing the first workload', async (): Promise<void> => {
    await expect(
      createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_bootstrap_starting',
        type: 'bootstrap',
      }),
    ).resolves.toBe('created');
    const [starting] = await db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres'));
    expect(starting?.status).toBe('starting');
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();

    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'resource-data', uid: 'uid-resource-data' }],
      leaseId: claimed?.leaseId ?? '',
      operationId: 'rr_bootstrap_starting',
      status: 'succeeded',
    });

    const runs: (typeof resourceReconcileRuns.$inferSelect)[] = await db.select().from(resourceReconcileRuns);
    const followUp: typeof resourceReconcileRuns.$inferSelect | undefined = runs.find(
      (run: typeof resourceReconcileRuns.$inferSelect): boolean => run.operationType === 'reconcile',
    );
    expect(JSON.parse(followUp?.intentJson ?? '{}')).toMatchObject({ replicas: 1 });
  });

  it('allows only one active bootstrap run for a resource', async (): Promise<void> => {
    await expect(
      createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_bootstrap_primary',
        type: 'bootstrap',
      }),
    ).resolves.toBe('created');
    await expect(
      createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_bootstrap_duplicate',
        type: 'bootstrap',
      }),
    ).resolves.toBe('bootstrap-active');

    const runs: (typeof resourceReconcileRuns.$inferSelect)[] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.operationType, 'bootstrap'));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe('rr_bootstrap_primary');
  });

  it('blocks resource reconciliation until project namespace provisioning succeeds', async (): Promise<void> => {
    await db
      .update(projectKubeProvisioning)
      .set({ state: 'pending' })
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_before_project_provisioning',
      type: 'bootstrap',
    });

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    await db
      .update(projectKubeProvisioning)
      .set({ state: 'succeeded' })
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    await expect(claimResourceReconcileRun()).resolves.toMatchObject({
      operationId: 'rr_before_project_provisioning',
    });
  });

  it('does not claim pending resource work after its project is archived', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_archived_project',
      type: 'bootstrap',
    });
    await db
      .update(projects)
      .set({ archivedAt: new Date('2026-07-15T12:00:00.000Z') })
      .where(eq(projects.id, 'prj_internal_tools'));

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    await expect(
      createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_created_after_archive',
        type: 'bootstrap',
      }),
    ).resolves.toBe('project-archived');
    await expect(
      db.select().from(resourceReconcileRuns).where(eq(resourceReconcileRuns.id, 'rr_created_after_archive')),
    ).resolves.toEqual([]);
  });

  it('cancels a running reconcile when its project is archived so unarchive cannot replay it', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_running_during_archive',
      type: 'reconcile',
    });
    await expect(claimResourceReconcileRun()).resolves.toMatchObject({ operationId: 'rr_running_during_archive' });
    const archivedAt: Date = new Date('2026-07-15T12:00:00.000Z');
    await db.transaction(async (tx: ResourceTransaction): Promise<void> => {
      await tx.update(projects).set({ archivedAt }).where(eq(projects.id, 'prj_internal_tools'));
      await cancelResourceReconcileRunsForProjectArchive(tx, 'prj_internal_tools', archivedAt);
    });
    await db
      .update(resourceReconcileRuns)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(resourceReconcileRuns.id, 'rr_running_during_archive'));
    await db.update(projects).set({ archivedAt: null }).where(eq(projects.id, 'prj_internal_tools'));

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
  });

  it('preserves pending delete cleanup when its project is archived', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await beginProjectResourceDeletion('res_postgres', true);
    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), deleteData: true, operation: 'delete', replicas: 0 },
      operationId: 'rr_delete_during_archive',
      type: 'reconcile',
    });
    const archivedAt: Date = new Date('2026-07-15T12:00:00.000Z');

    await db.transaction(async (tx: ResourceTransaction): Promise<void> => {
      await tx.update(projects).set({ archivedAt }).where(eq(projects.id, 'prj_internal_tools'));
      await cancelResourceReconcileRunsForProjectArchive(tx, 'prj_internal_tools', archivedAt);
    });

    await expect(
      db
        .select({ phase: resourceReconcileRuns.phase })
        .from(resourceReconcileRuns)
        .where(eq(resourceReconcileRuns.id, 'rr_delete_during_archive')),
    ).resolves.toEqual([{ phase: 'reconcile-pending' }]);
  });

  it('recovers an expired bootstrap after archive only to capture claim identities for cleanup', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_archived_expired_bootstrap',
      type: 'bootstrap',
    });
    const original: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(original?.operationId).toBe('rr_archived_expired_bootstrap');
    await db
      .update(resourceReconcileRuns)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(resourceReconcileRuns.id, 'rr_archived_expired_bootstrap'));
    await db
      .update(projects)
      .set({ archivedAt: new Date('2026-07-15T12:00:00.000Z') })
      .where(eq(projects.id, 'prj_internal_tools'));

    const recovered: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(recovered?.operationId).toBe('rr_archived_expired_bootstrap');
    expect(recovered?.leaseId).not.toBe(original?.leaseId);
    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      leaseId: recovered?.leaseId ?? '',
      operationId: recovered?.operationId ?? '',
      status: 'succeeded',
    });

    const [resource] = await db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres'));
    expect(resource?.expectedClaimsJson).toContain('uid-original');
    const runs: (typeof resourceReconcileRuns.$inferSelect)[] = await db.select().from(resourceReconcileRuns);
    expect(runs).toHaveLength(1);
  });

  it('fences bootstrap creation after resource deletion begins', async (): Promise<void> => {
    await beginProjectResourceDeletion('res_postgres', false);

    await expect(
      createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_bootstrap_after_delete',
        type: 'bootstrap',
      }),
    ).resolves.toBe('resource-deleting');
    await expect(
      db.select().from(resourceReconcileRuns).where(eq(resourceReconcileRuns.id, 'rr_bootstrap_after_delete')),
    ).resolves.toEqual([]);
  });

  it('lets an existing bootstrap finish claim capture after resource deletion begins', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_bootstrap_before_delete',
      type: 'bootstrap',
    });
    await beginProjectResourceDeletion('res_postgres', false);

    await expect(claimResourceReconcileRun()).resolves.toMatchObject({
      operationId: 'rr_bootstrap_before_delete',
      type: 'bootstrap',
    });
  });

  it('claims deletion ahead of older pending reconcile work after the deleting fence is set', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await createResourceReconcileRun({
      expectedClaims,
      intent: resourceIntent(),
      operationId: 'rr_pending_before_delete',
      type: 'reconcile',
    });
    await beginProjectResourceDeletion('res_postgres', true);
    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), deleteData: true, operation: 'delete', replicas: 0 },
      operationId: 'rr_delete_after_pending',
      type: 'reconcile',
    });

    await expect(claimResourceReconcileRun()).resolves.toMatchObject({
      operationId: 'rr_delete_after_pending',
    });
  });

  it('refuses a second active deletion for the same resource', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await beginProjectResourceDeletion('res_postgres', false);
    await expect(
      createResourceReconcileRun({
        expectedClaims,
        intent: { ...resourceIntent(), operation: 'delete', replicas: 0 },
        operationId: 'rr_delete_first',
        type: 'reconcile',
      }),
    ).resolves.toBe('created');

    await expect(
      createResourceReconcileRun({
        expectedClaims,
        intent: { ...resourceIntent(), deleteData: true, operation: 'delete', replicas: 0 },
        operationId: 'rr_delete_second',
        type: 'reconcile',
      }),
    ).resolves.toBe('resource-deleting');
  });

  it('allows a terminal metadata-only deletion to be upgraded to PVC deletion before row removal', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await beginProjectResourceDeletion('res_postgres', false);
    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), operation: 'delete', replicas: 0 },
      operationId: 'rr_delete_terminal',
      type: 'reconcile',
    });
    await db
      .update(resourceReconcileRuns)
      .set({ phase: 'succeeded' })
      .where(eq(resourceReconcileRuns.id, 'rr_delete_terminal'));

    await expect(
      createResourceReconcileRun({
        expectedClaims,
        intent: { ...resourceIntent(), deleteData: true, operation: 'delete', replicas: 0 },
        operationId: 'rr_delete_after_terminal',
        type: 'reconcile',
      }),
    ).resolves.toBe('created');
  });

  it('does not remove the resource row until the strongest concurrent delete demand succeeds', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await db
      .update(projectResources)
      .set({ expectedClaimsJson: JSON.stringify(expectedClaims) })
      .where(eq(projectResources.id, 'res_postgres'));
    await beginProjectResourceDeletion('res_postgres', false);
    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), operation: 'delete', replicas: 0 },
      operationId: 'rr_delete_metadata_only',
      type: 'reconcile',
    });
    await db
      .update(resourceReconcileRuns)
      .set({ phase: 'succeeded' })
      .where(eq(resourceReconcileRuns.id, 'rr_delete_metadata_only'));
    await beginProjectResourceDeletion('res_postgres', true);

    await expect(finalizeProjectResourceDeletion('res_postgres')).resolves.toEqual({
      deleteData: null,
      finalized: false,
    });
    await expect(
      db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres')),
    ).resolves.toHaveLength(1);

    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), deleteData: true, operation: 'delete', replicas: 0 },
      operationId: 'rr_delete_data',
      type: 'reconcile',
    });
    await db
      .update(resourceReconcileRuns)
      .set({ phase: 'succeeded' })
      .where(eq(resourceReconcileRuns.id, 'rr_delete_data'));
    await expect(finalizeProjectResourceDeletion('res_postgres')).resolves.toEqual({
      deleteData: true,
      finalized: true,
    });
    await expect(db.select().from(projectResources).where(eq(projectResources.id, 'res_postgres'))).resolves.toEqual(
      [],
    );
    await expect(finalizeProjectResourceDeletion('res_postgres')).resolves.toEqual({
      deleteData: true,
      finalized: true,
    });
  });

  it('retains a durable metadata-only deletion outcome after the resource row is removed', async (): Promise<void> => {
    await db.update(projectResources).set({ expectedClaimsJson: '[]' }).where(eq(projectResources.id, 'res_postgres'));
    await beginProjectResourceDeletion('res_postgres', false);

    await expect(finalizeProjectResourceDeletion('res_postgres')).resolves.toEqual({
      deleteData: false,
      finalized: true,
    });
    await expect(finalizeProjectResourceDeletion('res_postgres')).resolves.toEqual({
      deleteData: false,
      finalized: true,
    });
  });

  it('reports serialized predecessor work for reconcile wait budgeting', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await createResourceReconcileRun({
      expectedClaims,
      intent: resourceIntent(),
      operationId: 'rr_wait_predecessor',
      type: 'reconcile',
    });
    await createResourceReconcileRun({
      expectedClaims,
      intent: resourceIntent(),
      operationId: 'rr_wait_requested',
      type: 'reconcile',
    });

    await expect(readResourceReconcileRunWaitState('rr_wait_requested')).resolves.toMatchObject({
      phase: 'reconcile-pending',
      predecessorCount: 1,
    });
  });

  it('does not claim a resource operation while one of its PVC owners has active reconcile work', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_fences_product_job',
      type: 'reconcile',
    });
    await expect(claimResourceReconcileRun()).resolves.toMatchObject({ operationId: 'rr_fences_product_job' });
    await persistProductJobIntent({
      identityId: 'job_fenced_by_reconcile',
      intent: {
        command: ['bin/backup'],
        env: {},
        image: 'postgres:17',
        jobClass: 'resource-operation',
        namespace: 'cpt-prj-internal-tools',
        operationId: 'job_fenced_by_reconcile',
        projectId: 'prj_internal_tools',
        resourceIds: ['res_postgres'],
        runtimeIdentity: 'resource',
        timeoutMs: 30_000,
        volumeMounts: [
          {
            claimName: 'claim-data',
            expectedClaimUid: 'uid-original',
            mountPath: '/data',
            name: 'data',
            resourceId: 'res_postgres',
          },
        ],
      },
    });

    await expect(claimProductJob('resource-operation')).resolves.toEqual(unclaimedJob);
    await expect(db.select().from(productJobRuns)).resolves.toHaveLength(1);
  });

  it('claims an older queued resource operation before a later reconcile instead of deadlocking both', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'job_older_than_reconcile',
      intent: resourceOperationProductJobIntent('job_older_than_reconcile'),
    });
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_after_product_job',
      type: 'reconcile',
    });

    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'job_older_than_reconcile' },
    });
    await expect(claimResourceReconcileRun()).resolves.toBeNull();
  });

  it('claims an older queued reconcile before a later resource operation instead of deadlocking both', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_before_product_job',
      type: 'reconcile',
    });
    await persistProductJobIntent({
      identityId: 'job_after_reconcile',
      intent: resourceOperationProductJobIntent('job_after_reconcile'),
    });

    await expect(claimResourceReconcileRun()).resolves.toMatchObject({ operationId: 'rr_before_product_job' });
    await expect(claimProductJob('resource-operation')).resolves.toEqual(unclaimedJob);
  });

  it('keeps a running resource operation ahead of later reconcile work', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'job_fences_reconcile',
      intent: resourceOperationProductJobIntent('job_fences_reconcile'),
    });
    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'job_fences_reconcile' },
    });
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_fenced_by_product_job',
      type: 'reconcile',
    });

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'job_fences_reconcile' },
    });
  });

  it('keeps terminal resource-operation work fenced until Kubernetes cleanup is finalized', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'job_cleanup_fence',
      intent: resourceOperationProductJobIntent('job_cleanup_fence'),
    });
    await expect(claimProductJob('resource-operation')).resolves.toMatchObject({
      intent: { operationId: 'job_cleanup_fence' },
    });
    await persistProductJobResult({
      completedAt: '2026-07-15T12:00:00.000Z',
      exitCode: null,
      identityId: 'job_cleanup_fence',
      jobClass: 'resource-operation',
      jobName: 'job-cleanup-fence',
      logs: 'worker stopped before cleanup',
      podName: null,
      status: 'timed-out',
    });
    await createResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-original' }],
      intent: resourceIntent(),
      operationId: 'rr_waits_for_job_cleanup',
      type: 'reconcile',
    });

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    await persistProductJobFinalized('resource-operation', 'job_cleanup_fence');
    await expect(claimResourceReconcileRun()).resolves.toMatchObject({ operationId: 'rr_waits_for_job_cleanup' });
  });

  it('reports predecessor work from another resource in the globally serialized queue', async (): Promise<void> => {
    await db.insert(projectResources).values({
      commandJson: '[]',
      envJson: '[]',
      environmentId: 'env_production',
      id: 'res_redis',
      image: 'redis:8',
      name: 'redis',
      portsJson: '[6379]',
      readinessJson: 'null',
      runtimeDefinitionHash: 'runtime_hash_redis',
      status: 'running',
      volumesJson: '[]',
    });
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    await createResourceReconcileRun({
      expectedClaims,
      intent: { ...resourceIntent(), resourceId: 'res_redis', secretId: 'res_redis', volumes: [] },
      operationId: 'rr_other_resource_predecessor',
      type: 'reconcile',
    });
    await createResourceReconcileRun({
      expectedClaims,
      intent: resourceIntent(),
      operationId: 'rr_wait_after_other_resource',
      type: 'reconcile',
    });

    await expect(readResourceReconcileRunWaitState('rr_wait_after_other_resource')).resolves.toMatchObject({
      phase: 'reconcile-pending',
      predecessorCount: 1,
    });
  });

  it('orders same-resource runs by serialized creation instead of transaction start time', async (): Promise<void> => {
    const expectedClaims: ResourceClaimIdentity[] = [{ claimName: 'claim-data', uid: 'uid-original' }];
    let releaseDelayedCreation: (() => void) | undefined;
    const delayedCreation: Promise<CreateResourceReconcileRunResult> = db.transaction(
      async (tx: ResourceTransaction): Promise<CreateResourceReconcileRunResult> => {
        await tx.execute(sql`select now()`);
        await new Promise<void>((resolve: () => void): void => {
          releaseDelayedCreation = resolve;
        });
        return await createResourceReconcileRunWithExecutor(tx, {
          expectedClaims,
          intent: resourceIntent(),
          operationId: 'rr_committed_second',
          type: 'reconcile',
        });
      },
    );
    await waitForCondition((): boolean => releaseDelayedCreation !== undefined);
    await createResourceReconcileRun({
      expectedClaims,
      intent: resourceIntent(),
      operationId: 'rr_committed_first',
      type: 'reconcile',
    });
    releaseDelayedCreation?.();
    await expect(delayedCreation).resolves.toBe('created');

    await expect(claimResourceReconcileRun()).resolves.toMatchObject({ operationId: 'rr_committed_first' });
  });

  it('serializes resource claims with concurrent project archive', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_concurrent_project_archive',
      type: 'reconcile',
    });
    const holder: PoolClient = await pool.connect();
    let claim: Promise<ClaimedResourceReconcileRun | null> | null = null;
    try {
      await holder.query('begin');
      await holder.query(
        `update projects
         set archived_at = '2026-07-15T12:00:00.000Z'
         where id = 'prj_internal_tools'`,
      );
      claim = claimResourceReconcileRun();
      await expect(claim).resolves.toBeNull();
      await holder.query('commit');
      await expect(claimResourceReconcileRun()).resolves.toBeNull();
    } finally {
      await holder.query('rollback');
      await Promise.allSettled(claim === null ? [] : [claim]);
      holder.release();
    }
  });

  it('does not enqueue managed resource work when bootstrap finishes after archive', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_bootstrap_archived_during_execution',
      type: 'bootstrap',
    });
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(claimed?.operationId).toBe('rr_bootstrap_archived_during_execution');
    await db
      .update(projects)
      .set({ archivedAt: new Date('2026-07-15T12:00:00.000Z') })
      .where(eq(projects.id, 'prj_internal_tools'));

    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'claim-data', uid: 'uid-after-archive' }],
      leaseId: claimed!.leaseId,
      operationId: claimed!.operationId,
      status: 'succeeded',
    });

    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    await expect(db.select().from(resourceReconcileRuns)).resolves.toHaveLength(1);
  });

  it('creates, leases, and acknowledges the project provisioning companion row', async (): Promise<void> => {
    const project: ProjectRow = await createOrGetProject({
      defaultAccessMode: 'authenticated',
      id: 'prj_new_provisioning',
      name: 'new-provisioning',
      organizationId: 'org_resource_backups',
      updatedAt: new Date(),
    });
    const target: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    expect(target).toMatchObject({ namespaceId: project.id, projectId: project.id });
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: target?.isolationVersion ?? 1,
        leaseId: 'stale-lease',
        projectId: project.id,
        status: 'succeeded',
      }),
    ).resolves.toBe(false);
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: target?.isolationVersion ?? 1,
        leaseId: target!.leaseId,
        projectId: project.id,
        status: 'succeeded',
      }),
    ).resolves.toBe(true);
    await expect(
      db.select().from(projectKubeProvisioning).where(eq(projectKubeProvisioning.projectId, project.id)),
    ).resolves.toMatchObject([{ state: 'succeeded' }]);
    await expect(claimPendingProjectProvisioning()).resolves.toBeNull();
  });

  it('dead-letters project provisioning after three failures and fails waiting resource work', async (): Promise<void> => {
    await db
      .update(projectKubeProvisioning)
      .set({ attempts: 0, failureMessage: null, state: 'pending' })
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_unprovisionable_project',
      type: 'bootstrap',
    });

    for (let attempt: number = 1; attempt <= 3; attempt += 1) {
      const claimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
      expect(claimed?.projectId).toBe('prj_internal_tools');
      await expect(
        completeProjectProvisioning({
          action: 'provision',
          failureMessage: `provisioning attempt ${attempt} failed`,
          isolationVersion: claimed?.isolationVersion ?? 1,
          leaseId: claimed?.leaseId ?? '',
          projectId: 'prj_internal_tools',
          status: 'failed',
        }),
      ).resolves.toBe(true);
      await db
        .update(projectKubeProvisioning)
        .set({ updatedAt: new Date(0) })
        .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    }

    await expect(claimPendingProjectProvisioning()).resolves.toBeNull();
    const [provisioning] = await db
      .select()
      .from(projectKubeProvisioning)
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    expect(provisioning).toMatchObject({ attempts: 3, state: 'failed' });
    const [resourceRun] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, 'rr_unprovisionable_project'));
    expect(resourceRun).toMatchObject({ phase: 'failed' });
    expect(resourceRun?.failureMessage).toContain('provisioning attempt 3 failed');
    await expect(claimResourceReconcileRun()).resolves.toBeNull();

    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_after_terminal_provisioning',
      type: 'reconcile',
    });
    await expect(claimResourceReconcileRun()).resolves.toBeNull();
    const [futureRun] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, 'rr_after_terminal_provisioning'));
    expect(futureRun).toMatchObject({ phase: 'failed' });
    expect(futureRun?.failureMessage).toContain('provisioning attempt 3 failed');
  });

  it('serializes terminal provisioning with creation of future resource work', async (): Promise<void> => {
    const holder: PoolClient = await pool.connect();
    let creation: Promise<CreateResourceReconcileRunResult> | null = null;
    try {
      await holder.query('begin');
      await holder.query(
        `update project_kube_provisioning
         set attempts = 3, failure_message = 'terminal namespace failure', state = 'failed'
         where project_id = 'prj_internal_tools'`,
      );
      creation = createResourceReconcileRun({
        expectedClaims: [],
        intent: resourceIntent(),
        operationId: 'rr_concurrent_terminal_provisioning',
        type: 'reconcile',
      });
      await waitForDatabaseLock(holder, 'transactionid');
      await holder.query('commit');
      await creation;

      const [run] = await db
        .select()
        .from(resourceReconcileRuns)
        .where(eq(resourceReconcileRuns.id, 'rr_concurrent_terminal_provisioning'));
      expect(run).toMatchObject({ phase: 'failed' });
      expect(run?.failureMessage).toContain('terminal namespace failure');
    } finally {
      await holder.query('rollback');
      await Promise.allSettled(creation === null ? [] : [creation]);
      holder.release();
    }
  });

  it('reclaims an expired execution lease without consuming another failed attempt', async (): Promise<void> => {
    await db
      .update(projectKubeProvisioning)
      .set({
        attempts: 3,
        failureMessage: null,
        leaseExpiresAt: new Date(0),
        leaseId: 'expired-final-lease',
        state: 'running',
      })
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_expired_final_provisioning',
      type: 'bootstrap',
    });

    await expect(claimPendingProjectProvisioning()).resolves.toMatchObject({
      projectId: 'prj_internal_tools',
    });
    const [provisioning] = await db
      .select()
      .from(projectKubeProvisioning)
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));
    expect(provisioning).toMatchObject({ attempts: 3, state: 'running' });
    const [resourceRun] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, 'rr_expired_final_provisioning'));
    expect(resourceRun).toMatchObject({ phase: 'bootstrap-pending' });
  });

  it('renews cleanup authority only for the current unexpired provisioning lease', async (): Promise<void> => {
    await db
      .update(projectKubeProvisioning)
      .set({
        attempts: 1,
        leaseExpiresAt: new Date(0),
        leaseId: 'expired-cleanup-lease',
        state: 'running',
      })
      .where(eq(projectKubeProvisioning.projectId, 'prj_internal_tools'));

    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: 1,
        leaseId: 'expired-cleanup-lease',
        projectId: 'prj_internal_tools',
        status: 'running',
      }),
    ).resolves.toBe(false);
    const reclaimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    expect(reclaimed?.projectId).toBe('prj_internal_tools');
    await expect(
      completeProjectProvisioning({
        action: 'provision',
        failureMessage: null,
        isolationVersion: reclaimed?.isolationVersion ?? 1,
        leaseId: reclaimed?.leaseId ?? '',
        projectId: 'prj_internal_tools',
        status: 'running',
      }),
    ).resolves.toBe(true);
  });

  it('serializes concurrent reconcile claims for one resource', async (): Promise<void> => {
    const intent: ResourceReconcileIntent = resourceIntent();
    await Promise.all([
      createResourceReconcileRun({ expectedClaims: [], intent, operationId: 'rr_serial_1', type: 'reconcile' }),
      createResourceReconcileRun({ expectedClaims: [], intent, operationId: 'rr_serial_2', type: 'reconcile' }),
    ]);

    const claimed: (ClaimedResourceReconcileRun | null)[] = await Promise.all([
      claimResourceReconcileRun(),
      claimResourceReconcileRun(),
    ]);
    const active: ClaimedResourceReconcileRun[] = claimed.filter(
      (run: ClaimedResourceReconcileRun | null): run is ClaimedResourceReconcileRun => run !== null,
    );
    expect(active).toHaveLength(1);
    await acknowledgeResourceReconcileRun({
      leaseId: active[0]!.leaseId,
      operationId: active[0]!.operationId,
      status: 'succeeded',
    });

    const next: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(next?.operationId).not.toBe(active[0]!.operationId);
  });

  it('preserves a concurrent stop when bootstrap completion creates ordinary reconcile work', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_bootstrap_then_stop',
      type: 'bootstrap',
    });
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res_postgres'));

    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'resource-data', uid: 'uid-resource-data' }],
      leaseId: claimed?.leaseId ?? '',
      operationId: 'rr_bootstrap_then_stop',
      status: 'succeeded',
    });

    const runs: (typeof resourceReconcileRuns.$inferSelect)[] = await db.select().from(resourceReconcileRuns);
    const followUp: typeof resourceReconcileRuns.$inferSelect | undefined = runs.find(
      (run: typeof resourceReconcileRuns.$inferSelect): boolean => run.operationType === 'reconcile',
    );
    expect(JSON.parse(followUp?.intentJson ?? '{}')).toMatchObject({ replicas: 0 });
  });

  it('uses the latest descriptor intent when bootstrap completion creates ordinary reconcile work', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_bootstrap_latest_intent',
      type: 'bootstrap',
    });
    await db.transaction(
      async (tx: ResourceTransaction): Promise<void> =>
        await updateActiveResourceBootstrapIntent(tx, { ...resourceIntent(), image: 'postgres:18' }),
    );
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();

    await acknowledgeResourceReconcileRun({
      expectedClaims: [{ claimName: 'resource-data', uid: 'uid-resource-data' }],
      leaseId: claimed?.leaseId ?? '',
      operationId: 'rr_bootstrap_latest_intent',
      status: 'succeeded',
    });

    const runs: (typeof resourceReconcileRuns.$inferSelect)[] = await db.select().from(resourceReconcileRuns);
    const followUp: typeof resourceReconcileRuns.$inferSelect | undefined = runs.find(
      (run: typeof resourceReconcileRuns.$inferSelect): boolean => run.operationType === 'reconcile',
    );
    expect(JSON.parse(followUp?.intentJson ?? '{}')).toMatchObject({ image: 'postgres:18' });
  });

  it('uses one lock order for expired reclaim and late acknowledgement', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: resourceIntent(),
      operationId: 'rr_lock_order',
      type: 'reconcile',
    });
    const original: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    await db
      .update(resourceReconcileRuns)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(resourceReconcileRuns.id, 'rr_lock_order'));

    const holder: PoolClient = await pool.connect();
    const advisoryKey: number = 73_106_001;
    let reclaim: Promise<ClaimedResourceReconcileRun | null> | null = null;
    let acknowledgement: Promise<boolean> | null = null;
    try {
      await holder.query('select pg_advisory_lock($1)', [advisoryKey]);
      await holder.query(`
        create function test_block_resource_acknowledgement() returns trigger language plpgsql as $$
        begin
          if new.phase = 'succeeded' and old.phase = 'running' then
            perform pg_advisory_xact_lock(${advisoryKey});
          end if;
          return new;
        end
        $$
      `);
      await holder.query(`
        create trigger test_block_resource_acknowledgement
        after update on resource_reconcile_runs
        for each row execute function test_block_resource_acknowledgement()
      `);

      acknowledgement = acknowledgeResourceReconcileRun({
        leaseId: original?.leaseId ?? '',
        operationId: 'rr_lock_order',
        status: 'succeeded',
      });
      await waitForDatabaseLock(holder, 'advisory');
      reclaim = claimResourceReconcileRun();
      await Promise.race([reclaim.then((): void => undefined), waitForDatabaseLock(holder, 'transactionid')]);
      await holder.query('select pg_advisory_unlock($1)', [advisoryKey]);

      await expect(Promise.all([reclaim, acknowledgement])).resolves.toEqual([null, true]);
    } finally {
      await holder.query('select pg_advisory_unlock($1)', [advisoryKey]);
      await Promise.allSettled([
        ...(reclaim === null ? [] : [reclaim]),
        ...(acknowledgement === null ? [] : [acknowledgement]),
      ]);
      await holder.query('drop trigger if exists test_block_resource_acknowledgement on resource_reconcile_runs');
      await holder.query('drop function if exists test_block_resource_acknowledgement()');
      holder.release();
    }
  });

  it('persists stopped state only after a zero-replica reconcile succeeds', async (): Promise<void> => {
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: { ...resourceIntent(), replicas: 0 },
      operationId: 'rr_stop',
      type: 'reconcile',
    });
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(claimed?.operationId).toBe('rr_stop');
    await acknowledgeResourceReconcileRun({
      leaseId: claimed!.leaseId,
      operationId: claimed!.operationId,
      status: 'succeeded',
    });
    await expect(
      db
        .select({ status: projectResources.status })
        .from(projectResources)
        .where(eq(projectResources.id, 'res_postgres')),
    ).resolves.toEqual([{ status: 'stopped' }]);
  });
});

async function querySettlesBefore(query: Promise<QueryResult>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([
    query.then((): boolean => true),
    new Promise<boolean>(
      (resolve: (settled: boolean) => void): NodeJS.Timeout => setTimeout(resolve, timeoutMs, false),
    ),
  ]);
}

function resourceIntent(): ResourceReconcileIntent {
  return {
    command: [],
    deleteData: false,
    environmentId: 'env_resource_backups',
    env: {},
    image: 'postgres:17',
    namespaceId: 'prj_resource_backups',
    operation: 'reconcile',
    ports: [5432],
    readiness: null,
    replicas: 1,
    resourceId: 'res_postgres',
    secretId: 'res_postgres',
    volumes: [{ mountPath: '/var/lib/postgresql/data', size: '1Gi', volumeHandle: 'data' }],
  };
}

function resourceOperationProductJobIntent(operationId: string): ProductJobIntent {
  return {
    command: ['bin/backup'],
    env: {},
    image: 'postgres:17',
    jobClass: 'resource-operation',
    namespace: 'cpt-prj-internal-tools',
    operationId,
    projectId: 'prj_internal_tools',
    resourceIds: ['res_postgres'],
    runtimeIdentity: 'resource',
    timeoutMs: 30_000,
  };
}

async function seedResourceBackupScope(): Promise<void> {
  await seedOrganizationWithReadyQuota(db, 'org_resource_backups', 'Acme Dev', 'acme-dev');
  await db.insert(principals).values({
    email: 'admin@example.com',
    id: 'prn_resource_backups',
    type: 'user',
  });
  await db.insert(projects).values({
    defaultAccessMode: 'authenticated',
    id: 'prj_internal_tools',
    name: 'internal-tools',
    organizationId: 'org_resource_backups',
  });
  await seedCurrentProjectProvisioning(db, 'prj_internal_tools');
  await db.insert(environments).values({
    id: 'env_production',
    name: 'production',
    projectId: 'prj_internal_tools',
  });
  await seedResourceBackupOperation();
  await seedProjectResource();
}

async function seedResourceBackupOperation(): Promise<void> {
  await db.insert(operations).values({
    id: 'op_resource_backup',
    status: 'running',
    summary: 'Resource postgres backup is running.',
    targetId: 'res_postgres',
    targetType: 'resource',
    type: 'resource.backup',
  });
}

async function seedProjectResource(): Promise<void> {
  await db.insert(projectResources).values({
    commandJson: '[]',
    envJson: '[]',
    environmentId: 'env_production',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime_hash_123',
    status: 'running',
    volumesJson: '[{"name":"postgres-data","mountPath":"/var/lib/postgresql/data"}]',
  });
}

async function waitForDatabaseLock(client: PoolClient, waitEvent: string): Promise<void> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const result: { rows: { waiting: boolean }[] } = await client.query(
      `select exists (
        select 1
        from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and wait_event = $1
      ) as waiting`,
      [waitEvent],
    );
    if (result.rows[0]?.waiting === true) {
      return;
    }
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for PostgreSQL ${waitEvent} lock evidence.`);
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for database test condition.');
}
