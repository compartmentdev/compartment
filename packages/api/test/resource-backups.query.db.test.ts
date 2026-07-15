import { eq, sql } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environments,
  nodes,
  operations,
  organizations,
  principals,
  projectResources,
  projectKubeProvisioning,
  projects,
  resourceReconcileRuns,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
  failResourceBackupWithExecutor,
  findResourceBackupById,
  listResourceBackups,
  markResourceBackupRetentionDeletedWithExecutor,
} from '../src/queries/resource-backups.query';
import { listScheduledResourceOperationCandidates } from '../src/queries/resource-operation-scheduler.query';
import type { ResourceBackupRow } from '../src/queries/resource-backups.query.types';
import { findProjectResourceByName, lockProjectResourceReferenceByName } from '../src/queries/resources.query';
import { createResourceReconcileRun } from '../src/queries/resource-reconcile-create.query';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
} from '../src/queries/resource-reconcile-runs.query';
import {
  claimPendingProjectProvisioning,
  completeProjectProvisioning,
} from '../src/queries/project-provisioning.query';
import { createOrGetProject } from '../src/queries/projects.query';
import type { ResourceReconcileIntent } from '@compartment/contracts';
import type { ClaimedResourceReconcileRun } from '../src/queries/resource-reconcile-runs.query.types';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import type { ProjectProvisioningClaimRow } from '../src/queries/project-provisioning.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { parseStoredResourceOperations } from '../src/services/resources.service.storage';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'resource_backups_query_db');
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
  resourceBackupDirectory: '/tmp/compartment-test-resource-backups',
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
  sourceArchiveMaxBytes: 104_857_600,
  throttle: defaultApiAuthThrottleConfig,
  nodeAgentSocketPath: '/tmp/compartment/api-test/node/integration.sock',
  systemApiSocketPath: '/tmp/compartment/compartment-test-system-api.sock',
  systemToken: 'test-system-token',
  trustedOutboundHosts: [],
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('resource backup queries', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: seedResourceBackupScope,
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

  it('leases explicit bootstrap, persists canonical UIDs, and recovers only stale work', async (): Promise<void> => {
    const intent: ResourceReconcileIntent = resourceIntent();
    await createResourceReconcileRun({ expectedClaims: [], intent, operationId: 'rr_bootstrap', type: 'bootstrap' });
    const bootstrap: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    expect(bootstrap).toMatchObject({ operationId: 'rr_bootstrap', type: 'bootstrap' });
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
    await acknowledgeResourceReconcileRun({
      leaseId: ordinary!.leaseId,
      operationId: ordinary!.operationId,
      status: 'succeeded',
    });
    const [stillRunning] = await db
      .select()
      .from(resourceReconcileRuns)
      .where(eq(resourceReconcileRuns.id, ordinary!.operationId));
    expect(stillRunning?.phase).toBe('running');
    await acknowledgeResourceReconcileRun({
      leaseId: recovered!.leaseId,
      operationId: recovered!.operationId,
      status: 'running',
    });
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

  it('creates, leases, and acknowledges the project provisioning companion row', async (): Promise<void> => {
    const project: ProjectRow = await createOrGetProject({
      id: 'prj_new_provisioning',
      name: 'new-provisioning',
      organizationId: 'org_resource_backups',
      updatedAt: new Date(),
    });
    const target: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    expect(target).toMatchObject({ namespaceId: project.id, projectId: project.id });
    await expect(
      completeProjectProvisioning({
        failureMessage: null,
        leaseId: 'stale-lease',
        projectId: project.id,
        status: 'succeeded',
      }),
    ).resolves.toBe(false);
    await expect(
      completeProjectProvisioning({
        failureMessage: null,
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
          failureMessage: `provisioning attempt ${attempt} failed`,
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
    let creation: Promise<void> | null = null;
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
        failureMessage: null,
        leaseId: 'expired-cleanup-lease',
        projectId: 'prj_internal_tools',
        status: 'running',
      }),
    ).resolves.toBe(false);
    const reclaimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    expect(reclaimed?.projectId).toBe('prj_internal_tools');
    await expect(
      completeProjectProvisioning({
        failureMessage: null,
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
    let acknowledgement: Promise<void> | null = null;
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

      await expect(Promise.all([reclaim, acknowledgement])).resolves.toEqual([null, undefined]);
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

function resourceIntent(): ResourceReconcileIntent {
  return {
    containerPort: 5432,
    deleteData: false,
    environmentId: 'env_resource_backups',
    env: {},
    image: 'postgres:17',
    namespaceId: 'prj_resource_backups',
    operation: 'reconcile',
    replicas: 1,
    resourceId: 'res_postgres',
    secretId: 'res_postgres',
    volumes: [{ mountPath: '/var/lib/postgresql/data', size: '1Gi', volumeHandle: 'data' }],
  };
}

async function seedResourceBackupScope(): Promise<void> {
  await db.insert(organizations).values({ id: 'org_resource_backups', name: 'Acme Dev', slug: 'acme-dev' });
  await db.insert(principals).values({
    email: 'admin@example.com',
    id: 'prn_resource_backups',
    type: 'user',
  });
  await db.insert(nodes).values({
    id: 'node_resource_backups',
    name: 'node-resource-backups',
    nodeUrl: '/tmp/compartment/api-test/node/resource-backups.sock',
    nodeSocketPath: '/tmp/compartment/api-test/node/resource-backups.sock',
    nodeVersion: '0.1.0',
  });
  await db.insert(projects).values({
    id: 'prj_internal_tools',
    name: 'internal-tools',
    organizationId: 'org_resource_backups',
  });
  await db.insert(projectKubeProvisioning).values({ projectId: 'prj_internal_tools', state: 'succeeded' });
  await db.insert(environments).values({
    id: 'env_production',
    name: 'production',
    nodeId: 'node_resource_backups',
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
    hostname: 'postgres.production.internal-tools.resource.internal',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    portsJson: '[5432]',
    readinessJson: 'null',
    restartPolicy: 'unless-stopped',
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
