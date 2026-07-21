import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { immutableKubeName } from '@compartment/utils';
import type { ProductLogIngestEvent, ResourceLogLine } from '@compartment/contracts';
import {
  deploymentKubeReferences,
  deploymentProductLogs,
  deployments,
  productJobRuns,
  productLogStoreQuota,
  projectResources,
  projects,
} from '../src/db/schema';
import { findActiveJoinedDeployment } from '../src/queries/deployment-joined.query';
import type { DeploymentJoinedRow } from '../src/queries/deployments.query.types';
import { persistProductJobIntent } from '../src/queries/product-job-intent.query';
import { claimProductJob } from '../src/queries/product-job-runs.query';
import {
  ingestDeploymentProductLogs,
  readStoredDeploymentProductLogs,
  readStoredResourceProductLogs,
} from '../src/services/deployment-product-logs.service';
import { runProductLogRetentionCleanup } from '../src/services/product-log-retention.service';
import { listDeploymentProductLogLines } from '../src/queries/deployment-product-logs.query';
import type { DeploymentProductLogLine } from '../src/queries/deployment-product-logs.query.types';
import { productLogRecordOverheadBytes, productLogStoreMaxBytes } from '../src/queries/product-log-storage-policy';
import {
  createDeploymentKubeReferenceDatabaseTestContext,
  seedCandidate,
  seedDeployment,
  useApiRuntimeDatabaseTestHarness,
} from './deployment-kube-reference.query.db.harness';

const { apiConfig, databaseUrl, db, pool } = createDeploymentKubeReferenceDatabaseTestContext(
  'deployment_kube_reference_logs',
);

describe('deployment Kubernetes transition persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => await seedDeployment(db),
  });

  it('does not recover a queued release Job after its project is archived', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'dep_kube',
      intent: {
        command: ['bin/release'],
        deploymentId: 'dep_kube',
        env: {},
        image: 'registry.example/release@sha256:abc',
        imagePullSecretId: 'pull-project',
        jobClass: 'release',
        namespace: 'cpt-prj-kube',
        projectId: 'prj_kube',
        timeoutMs: 30_000,
      },
    });
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, 'prj_kube'));

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_kube' },
      persistedResult: { status: 'timed-out' },
    });
    await expect(db.select().from(productJobRuns)).resolves.toMatchObject([{ status: 'timed-out' }]);
  });

  it('does not restart a claimed release Job after its project is archived', async (): Promise<void> => {
    await persistProductJobIntent({
      identityId: 'dep_kube',
      intent: {
        command: ['bin/release'],
        deploymentId: 'dep_kube',
        env: {},
        image: 'registry.example/release@sha256:abc',
        imagePullSecretId: 'pull-project',
        jobClass: 'release',
        namespace: 'cpt-prj-kube',
        projectId: 'prj_kube',
        timeoutMs: 30_000,
      },
    });
    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_kube' },
    });
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, 'prj_kube'));

    await expect(claimProductJob('release')).resolves.toMatchObject({
      intent: { deploymentId: 'dep_kube' },
      persistedResult: { status: 'timed-out' },
    });
    await expect(db.select().from(productJobRuns)).resolves.toMatchObject([{ status: 'timed-out' }]);
  });

  it('deduplicates reopened kubelet files by Pod UID, restart identity, and offset', async (): Promise<void> => {
    const event: ProductLogIngestEvent = {
      containerName: immutableKubeName('app', 'dep_kube'),
      message: 'ready',
      namespace: 'cpt-prj-kube',
      podName: 'app-env-kube-svc-kube-abc',
      podUid: '11111111-1111-4111-8111-111111111111',
      restartIdentity: '0',
      sourceFingerprint: 'a'.repeat(64),
      sourceOffset: 17,
      stream: 'stdout',
      timestamp: '2026-07-12T10:00:00.000Z',
    };

    await expect(ingestDeploymentProductLogs([event])).resolves.toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    await expect(ingestDeploymentProductLogs([event])).resolves.toEqual({ accepted: 0, duplicates: 1, rejected: 0 });
    await expect(
      ingestDeploymentProductLogs([{ ...event, message: 'after rotation', sourceFingerprint: 'b'.repeat(64) }]),
    ).resolves.toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    await expect(db.select().from(deploymentProductLogs)).resolves.toHaveLength(2);
  });

  it('stores Kubernetes resource container logs under the resource identity', async (): Promise<void> => {
    const resourceId: string = 'res_2df21be0b23d4e0f9ebe493950cf89a7';
    const otherResourceId: string = `res_${'b'.repeat(32)}`;
    const podName: string = `${immutableKubeName('resource', resourceId).slice(0, -4)}djqt5`;
    expect(podName).toBe('resource-res-2df21be0b23d4e0f9ebe493950cf89a7-c432897ab9d0djqt5');
    await db.insert(projectResources).values({
      commandJson: '[]',
      createdAt: new Date('2026-07-11T10:00:00.000Z'),
      envJson: '[]',
      environmentId: 'env_kube',
      expectedClaimsJson: '[]',
      id: resourceId,
      image: 'postgres:16',
      name: 'postgres',
      outputsJson: '{}',
      portsJson: '[5432]',
      readinessJson: '{"type":"tcp","port":5432,"timeoutMs":30000}',
      runtimeDefinitionHash: 'resource-hash',
      status: 'running',
      volumesJson: '[]',
    });
    const event: ProductLogIngestEvent = {
      containerName: 'resource',
      message: 'database system is ready',
      namespace: immutableKubeName('cpt', 'prj_kube'),
      podName,
      podUid: '12121212-1212-4212-8212-121212121212',
      restartIdentity: '0',
      sourceFingerprint: 'c'.repeat(64),
      sourceOffset: 1,
      stream: 'stderr',
      timestamp: '2026-07-10T10:00:00.000Z',
    };

    await expect(
      ingestDeploymentProductLogs([{ ...event, namespace: immutableKubeName('cpt', 'prj_other') }]),
    ).resolves.toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    await expect(
      ingestDeploymentProductLogs([{ ...event, podName: `${immutableKubeName('resource', otherResourceId)}-abc` }]),
    ).resolves.toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
    await expect(ingestDeploymentProductLogs([event])).resolves.toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
    const lines: ResourceLogLine[] = await readStoredResourceProductLogs(resourceId, 'postgres', undefined, 50);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line: ResourceLogLine): boolean => line.stream === 'stderr')).toBe(true);
    expect(lines).toEqual([
      {
        message: 'database system is ready',
        resourceName: 'postgres',
        stream: 'stderr',
        timestamp: '2026-07-10T10:00:00.000Z',
      },
    ]);
  });

  it('keeps every stored line across the P2-style Pod replacement', async (): Promise<void> => {
    await seedCandidate(db);
    await db.update(deploymentKubeReferences).set({ deploymentName: 'app-stable-workload' });
    const oldPod: ProductLogIngestEvent[] = buildProductLogSequence(
      '11111111-1111-4111-8111-111111111111',
      'old',
      0,
      200,
    );
    const newPod: ProductLogIngestEvent[] = buildProductLogSequence(
      '22222222-2222-4222-8222-222222222222',
      'new',
      200,
      200,
      '0',
      'dep_candidate',
    );

    await expect(ingestDeploymentProductLogs(oldPod)).resolves.toMatchObject({ accepted: 200 });
    await expect(ingestDeploymentProductLogs(newPod)).resolves.toMatchObject({ accepted: 200 });
    await db.update(deployments).set({ isActive: false }).where(eq(deployments.id, 'dep_kube'));
    await db.update(deployments).set({ isActive: true }).where(eq(deployments.id, 'dep_candidate'));
    const active: DeploymentJoinedRow | undefined = await findActiveJoinedDeployment(
      'env_kube',
      'svc_kube',
      'localhost',
    );
    expect(active?.deployment.id).toBe('dep_candidate');
    if (active === undefined) {
      throw new Error('Expected the candidate deployment to be active.');
    }
    const lines: DeploymentProductLogLine[] = await readStoredDeploymentProductLogs(
      [active],
      'production',
      undefined,
      500,
    );
    expect(lines).toHaveLength(400);
    expect(lines.map((line: DeploymentProductLogLine): string => line.message)).toEqual([
      ...oldPod.map((event: ProductLogIngestEvent): string => event.message),
      ...newPod.map((event: ProductLogIngestEvent): string => event.message),
    ]);
  });

  it('backpressures ingest when the global product-log storage quota is exhausted', async (): Promise<void> => {
    await db
      .update(productLogStoreQuota)
      .set({ usedBytes: productLogStoreMaxBytes - productLogRecordOverheadBytes })
      .where(eq(productLogStoreQuota.id, 'global'));
    const [event] = buildProductLogSequence('55555555-5555-4555-8555-555555555555', 'quota', 0, 1);

    await expect(ingestDeploymentProductLogs([event!])).resolves.toEqual({
      accepted: 0,
      deferred: 1,
      duplicates: 0,
      rejected: 1,
    });
    await expect(db.select().from(deploymentProductLogs)).resolves.toHaveLength(0);
  });

  it('bounds OOM-restart loss to zero persisted lines and deduplicates the replay', async (): Promise<void> => {
    const beforeOom: ProductLogIngestEvent[] = buildProductLogSequence(
      '33333333-3333-4333-8333-333333333333',
      'before-oom',
      0,
      50,
    );
    const afterOom: ProductLogIngestEvent[] = buildProductLogSequence(
      '33333333-3333-4333-8333-333333333333',
      'after-oom',
      50,
      50,
      '1',
    );
    await ingestDeploymentProductLogs(beforeOom);
    await ingestDeploymentProductLogs(afterOom);
    await expect(ingestDeploymentProductLogs([...beforeOom, ...afterOom])).resolves.toEqual({
      accepted: 0,
      duplicates: 100,
      rejected: 0,
    });
    await expect(listDeploymentProductLogLines({ deploymentIds: ['dep_kube'], limit: 500 })).resolves.toHaveLength(100);
  });

  it('rejects non-product Kubernetes workload identities instead of guessing a deployment', async (): Promise<void> => {
    await expect(
      ingestDeploymentProductLogs([
        {
          containerName: 'app-unknown',
          message: 'ignored',
          namespace: 'cpt-prj-kube',
          podName: 'unknown',
          podUid: '22222222-2222-4222-8222-222222222222',
          restartIdentity: '0',
          sourceFingerprint: 'c'.repeat(64),
          sourceOffset: 0,
          stream: 'stderr',
          timestamp: '2026-07-12T10:00:00.000Z',
        },
      ]),
    ).resolves.toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
  });

  it('rejects the removed unqualified app workload identity', async (): Promise<void> => {
    const [event]: ProductLogIngestEvent[] = buildProductLogSequence(
      '44444444-4444-4444-8444-444444444444',
      'legacy',
      0,
      1,
    );
    expect(event).toBeDefined();
    await expect(
      ingestDeploymentProductLogs([{ ...event!, containerName: 'app', podName: 'app-dep-kube-oldpod' }]),
    ).resolves.toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
  });

  it('stores source offsets beyond the PostgreSQL integer range', async (): Promise<void> => {
    const [event]: ProductLogIngestEvent[] = buildProductLogSequence(
      '77777777-7777-4777-8777-777777777777',
      'large-offset',
      0,
      1,
    );

    await expect(ingestDeploymentProductLogs([{ ...event!, sourceOffset: 2_147_483_648 }])).resolves.toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
    });
    const [storedEvent] = await db
      .select({ sourceOffset: deploymentProductLogs.sourceOffset })
      .from(deploymentProductLogs)
      .where(eq(deploymentProductLogs.podUid, '77777777-7777-4777-8777-777777777777'));
    expect(storedEvent?.sourceOffset).toBe(2_147_483_648);
  });

  it('deletes expired product logs in bounded retention batches', async (): Promise<void> => {
    const retainedEvents: ProductLogIngestEvent[] = [
      {
        containerName: immutableKubeName('app', 'dep_kube'),
        message: 'expired',
        namespace: 'cpt-prj-kube',
        podName: 'old-pod',
        podUid: '33333333-3333-4333-8333-333333333333',
        restartIdentity: '0',
        sourceFingerprint: 'd'.repeat(64),
        sourceOffset: 0,
        stream: 'stdout',
        timestamp: '2025-01-01T00:00:00.000Z',
      },
      {
        containerName: immutableKubeName('app', 'dep_kube'),
        message: 'also-expired',
        namespace: 'cpt-prj-kube',
        podName: 'old-pod',
        podUid: '33333333-3333-4333-8333-333333333333',
        restartIdentity: '0',
        sourceFingerprint: 'e'.repeat(64),
        sourceOffset: 128,
        stream: 'stdout',
        timestamp: '2025-01-01T00:00:01.000Z',
      },
      {
        containerName: immutableKubeName('app', 'dep_kube'),
        message: 'fresh',
        namespace: 'cpt-prj-kube',
        podName: 'current-pod',
        podUid: '44444444-4444-4444-8444-444444444444',
        restartIdentity: '0',
        sourceFingerprint: 'f'.repeat(64),
        sourceOffset: 0,
        stream: 'stdout',
        timestamp: '2026-07-14T00:00:00.000Z',
      },
    ];
    await ingestDeploymentProductLogs(retainedEvents);
    await db
      .update(deploymentProductLogs)
      .set({ capturedAt: new Date('2025-01-01T00:00:00.000Z') })
      .where(eq(deploymentProductLogs.podUid, '33333333-3333-4333-8333-333333333333'));
    const [quotaBeforeCleanup] = await db.select().from(productLogStoreQuota);

    await expect(runProductLogRetentionCleanup()).resolves.toEqual({ deletedCount: 1 });
    const remaining: (typeof deploymentProductLogs.$inferSelect)[] = await db.select().from(deploymentProductLogs);
    const [quotaAfterCleanup] = await db.select().from(productLogStoreQuota);
    expect(remaining).toHaveLength(2);
    expect(remaining.some((row: typeof deploymentProductLogs.$inferSelect): boolean => row.message === 'fresh')).toBe(
      true,
    );
    expect(quotaAfterCleanup!.usedBytes).toBeLessThan(quotaBeforeCleanup!.usedBytes);
  });

  it('releases product-log quota when deployment cascade deletes stored logs', async (): Promise<void> => {
    const [event] = buildProductLogSequence('55555555-5555-4555-8555-555555555555', 'cascade', 0, 1);
    await ingestDeploymentProductLogs([event!]);
    const [quotaBeforeDelete] = await db.select().from(productLogStoreQuota);

    await db.delete(deployments).where(eq(deployments.id, 'dep_kube'));

    const [quotaAfterDelete] = await db.select().from(productLogStoreQuota);
    expect(quotaBeforeDelete!.usedBytes).toBeGreaterThan(0);
    expect(quotaAfterDelete!.usedBytes).toBe(0);
  });
});

function buildProductLogSequence(
  podUid: string,
  marker: string,
  start: number,
  count: number,
  restartIdentity: string = '0',
  deploymentId: string = 'dep_kube',
): ProductLogIngestEvent[] {
  return [...Array<number>(count).keys()].map((index: number): ProductLogIngestEvent => {
    const sequence: number = start + index;
    return {
      containerName: immutableKubeName('app', deploymentId),
      message: `${marker}-${sequence.toString().padStart(6, '0')}`,
      namespace: 'cpt-prj-kube',
      podName: `${marker}-pod`,
      podUid,
      restartIdentity,
      sourceFingerprint: sequence.toString(16).padStart(64, '0'),
      sourceOffset: index * 128,
      stream: 'stdout',
      timestamp: new Date(Date.parse('2026-07-14T10:00:00.000Z') + sequence).toISOString(),
    };
  });
}
