import type {
  ProductJobIntent,
  ResourceClaimIdentity,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  environments,
  operations,
  organizationMemberships,
  organizationQuotaReconciliation,
  organizations,
  principals,
  projectResources,
  projects,
  resourceReconcileRuns,
} from '../src/db/schema';
import {
  completeResourceBackupWithExecutor,
  createResourceBackupWithExecutor,
} from '../src/queries/resource-backups.query';
import { claimProductJob, persistProductJobFinalized } from '../src/queries/product-job-runs.query';
import { persistProductJobResult } from '../src/queries/product-job-result.query';
import type { ClaimedProductJobQueryResult } from '../src/queries/product-job-runs.query.types';
import {
  acknowledgeResourceReconcileRun,
  claimResourceReconcileRun,
} from '../src/queries/resource-reconcile-runs.query';
import type { ClaimedResourceReconcileRun } from '../src/queries/resource-reconcile-runs.query.types';
import { findProjectResourceByName } from '../src/queries/resources.query';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import { restoreResourceBackupAsForPrincipal } from '../src/services/resource-backups.restore-as.service';
import { serializeResourceDefinitionSnapshot } from '../src/services/resources.service.storage';
import type { ResourceRestoreAsResult } from '../src/services/resources.service.types';
import { seedCurrentProjectProvisioning, useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { createApiTestConfig } from './api-config-test.fixtures';

const backupId: string = 'rbak_restore_as';
const backupChecksum: string = 'a'.repeat(64);
const backupSizeBytes: number = 128;
const sourceResourceId: string = 'res_postgres';
const targetResourceName: string = 'postgres-copy';
const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'resource_backups_restore_as');
const apiConfig: ApiConfig = buildApiConfig(databaseUrl);
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('resource backup restore-as', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: seedRestoreAsScope,
  });

  it('waits for bootstrap and reconcile before restoring into the new resource', async (): Promise<void> => {
    let restoreSettled: boolean = false;
    const restoration: Promise<ResourceRestoreAsResult> = restoreResourceBackupAsForPrincipal({
      actorPrincipalId: 'prn_restore_as',
      body: { targetResourceName },
      organizationSlug: 'restore-as',
      query: {
        backupId,
        environmentName: 'production',
        projectName: 'database',
      },
    });
    void restoration.then(
      (): void => {
        restoreSettled = true;
      },
      (): void => {
        restoreSettled = true;
      },
    );

    const target: ProjectResourceRow = await waitForPendingTargetBootstrap();
    await delay(100);
    expect(restoreSettled).toBe(false);

    const bootstrap: ClaimedResourceReconcileRun = await waitForResourceReconcileClaim();
    expect(bootstrap).toMatchObject({
      intent: { resourceId: target.id },
      type: 'bootstrap',
    });
    await acknowledgeResourceReconcileRun({
      expectedClaims: targetClaims(target.id),
      leaseId: bootstrap.leaseId,
      operationId: bootstrap.operationId,
      status: 'succeeded',
    });

    const reconcile: ClaimedResourceReconcileRun = await waitForResourceReconcileClaim();
    expect(reconcile).toMatchObject({
      intent: { resourceId: target.id },
      type: 'reconcile',
    });
    await acknowledgeResourceReconcileRun({
      leaseId: reconcile.leaseId,
      operationId: reconcile.operationId,
      status: 'succeeded',
    });

    const verifier: ProductJobIntent = await waitForResourceOperationClaim();
    expect(verifier).toMatchObject({
      jobClass: 'resource-operation',
      resourceIds: [sourceResourceId],
      volumeMounts: [
        {
          expectedClaimUid: 'uid-source-artifacts',
          readOnly: true,
          resourceId: sourceResourceId,
        },
      ],
    });
    await completeResourceOperation(
      verifier,
      `COMPARTMENT_ARTIFACT_METADATA ${JSON.stringify({ checksum: backupChecksum, sizeBytes: backupSizeBytes })}`,
    );

    const restore: ProductJobIntent = await waitForResourceOperationClaim();
    expect(restore).toMatchObject({
      command: ['sh', '-c', 'pg_restore "$COMPARTMENT_BACKUP_DIR"'],
      jobClass: 'resource-operation',
      resourceIds: [target.id, sourceResourceId],
      volumeMounts: [
        {
          expectedClaimUid: 'uid-source-artifacts',
          readOnly: true,
          resourceId: sourceResourceId,
        },
      ],
    });
    await completeResourceOperation(restore, 'restore completed');

    await expect(restoration).resolves.toMatchObject({
      resource: { id: target.id, name: targetResourceName, status: 'running' },
      restoredBackup: { id: backupId },
      sourceResource: { id: sourceResourceId },
    });
  });
});

async function waitForPendingTargetBootstrap(): Promise<ProjectResourceRow> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const target: ProjectResourceRow | undefined = await findProjectResourceByName(
      'env_restore_as',
      targetResourceName,
    );
    if (target !== undefined) {
      const [bootstrap] = await db
        .select({ id: resourceReconcileRuns.id })
        .from(resourceReconcileRuns)
        .where(
          and(
            eq(resourceReconcileRuns.projectResourceId, target.id),
            eq(resourceReconcileRuns.operationType, 'bootstrap'),
          ),
        )
        .limit(1);
      if (bootstrap !== undefined) {
        return target;
      }
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for restore-as bootstrap work.');
}

async function waitForResourceReconcileClaim(): Promise<ClaimedResourceReconcileRun> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const claimed: ClaimedResourceReconcileRun | null = await claimResourceReconcileRun();
    if (claimed !== null) {
      return claimed;
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for resource reconcile work.');
}

async function waitForResourceOperationClaim(): Promise<ProductJobIntent> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const claimed: ClaimedProductJobQueryResult = await claimProductJob('resource-operation');
    if (claimed.intent !== null) {
      return claimed.intent;
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for resource operation work.');
}

async function completeResourceOperation(intent: ProductJobIntent, logs: string): Promise<void> {
  if (intent.jobClass !== 'resource-operation') {
    throw new Error('Expected a resource-operation Product Job.');
  }
  const result: WorkerPersistProductJobResultRequest = {
    completedAt: '2026-07-16T12:00:00.000Z',
    exitCode: 0,
    identityId: intent.operationId,
    jobClass: 'resource-operation',
    jobName: `job-${intent.operationId}`,
    logs,
    podName: `pod-${intent.operationId}`,
    status: 'succeeded',
  };
  await persistProductJobResult(result);
  await persistProductJobFinalized('resource-operation', intent.operationId);
}

function targetClaims(resourceId: string): ResourceClaimIdentity[] {
  return [
    { claimName: immutableKubeName('volume', `${resourceId}:data`), uid: 'uid-target-data' },
    { claimName: immutableKubeName('volume', `${resourceId}:backup-artifacts`), uid: 'uid-target-artifacts' },
  ];
}

async function seedRestoreAsScope(): Promise<void> {
  await db.insert(organizations).values({ id: 'org_restore_as', name: 'Restore As', slug: 'restore-as' });
  await db.insert(organizationQuotaReconciliation).values({ organizationId: 'org_restore_as', state: 'succeeded' });
  await db.insert(principals).values({
    email: 'restore-as@example.com',
    id: 'prn_restore_as',
    type: 'user',
  });
  await db.insert(organizationMemberships).values({
    id: 'mem_restore_as',
    organizationId: 'org_restore_as',
    principalId: 'prn_restore_as',
  });
  await db.insert(projects).values({
    defaultAccessMode: 'authenticated',
    id: 'prj_restore_as',
    name: 'database',
    organizationId: 'org_restore_as',
  });
  await seedCurrentProjectProvisioning(db, 'prj_restore_as');
  await db.insert(environments).values({
    id: 'env_restore_as',
    name: 'production',
    projectId: 'prj_restore_as',
  });
  await db.insert(projectResources).values({
    commandJson: '[]',
    envJson: '[]',
    environmentId: 'env_restore_as',
    expectedClaimsJson: JSON.stringify([
      {
        claimName: immutableKubeName('volume', `${sourceResourceId}:backup-artifacts`),
        uid: 'uid-source-artifacts',
      },
    ] satisfies ResourceClaimIdentity[]),
    id: sourceResourceId,
    image: 'postgres:17',
    name: 'postgres',
    operationConfigHash: 'operation-hash',
    operationsJson: JSON.stringify({
      backup: null,
      restore: {
        command: 'pg_restore "$COMPARTMENT_BACKUP_DIR"',
        env: [],
        image: null,
        schedule: null,
      },
    }),
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime-hash',
    status: 'running',
    volumesJson: '[{"mountPath":"/var/lib/postgresql/data","name":"data"}]',
  });
  await seedCompletedBackup();
}

async function seedCompletedBackup(): Promise<void> {
  await db.insert(operations).values({
    id: 'op_restore_as_backup',
    status: 'succeeded',
    summary: 'Resource postgres backup succeeded.',
    targetId: sourceResourceId,
    targetType: 'resource',
    type: 'resource.backup',
  });
  await createResourceBackupWithExecutor(db, {
    createdByPrincipalId: 'prn_restore_as',
    id: backupId,
    operationId: 'op_restore_as_backup',
    projectResourceId: sourceResourceId,
    purpose: 'manual',
    status: 'running',
  });
  const source: ProjectResourceRow | undefined = await findProjectResourceByName('env_restore_as', 'postgres');
  if (source === undefined) {
    throw new Error('Expected the source resource to exist.');
  }
  await completeResourceBackupWithExecutor(db, {
    artifactLocation: `pvc://${backupId}`,
    backupId,
    checksum: backupChecksum,
    completedAt: new Date('2026-07-16T10:00:00.000Z'),
    manifestJson: '{"status":"succeeded"}',
    resourceDefinitionJson: serializeResourceDefinitionSnapshot(source),
    sizeBytes: backupSizeBytes,
    stderrSummary: '',
    stdoutSummary: 'backup completed',
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, milliseconds));
}

function buildApiConfig(url: string): ApiConfig {
  return createApiTestConfig({
    databaseUrl: url,
    workerImageRef: 'compartment-worker@sha256:test',
  });
}
