import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { immutableKubeName } from '@compartment/utils';
import type { ProductLogIngestEvent } from '@compartment/contracts';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  auditEvents,
  buildArtifacts,
  deploymentKubeReferences,
  deploymentProductLogs,
  deploymentRunEvents,
  deploymentRuns,
  deploymentRoutes,
  deployments,
  environments,
  nodes,
  operations,
  organizations,
  projectServices,
  projectKubeProvisioning,
  projects,
  productLogStoreQuota,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  persistDeploymentKubeTransition,
  upsertDeploymentKubeReference,
} from '../src/queries/deployment-kube-reference.query';
import type { PersistDeploymentKubeTransitionInput } from '../src/queries/deployment-kube-reference.query.types';
import {
  findNextDeploymentReconcilePair,
  persistDeploymentReconcileObservation,
  prepareDeploymentReconcileReference,
} from '../src/queries/deployment-reconcile.query';
import type { DeploymentReconcilePair } from '../src/queries/deployment-reconcile.query.types';
import { findActiveDeploymentRouteByHost } from '../src/queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import {
  ingestDeploymentProductLogs,
  readStoredDeploymentProductLogs,
} from '../src/services/deployment-product-logs.service';
import { runProductLogRetentionCleanup } from '../src/services/product-log-retention.service';
import { listDeploymentProductLogLines } from '../src/queries/deployment-product-logs.query';
import type { DeploymentProductLogLine } from '../src/queries/deployment-product-logs.query.types';
import { productLogRecordOverheadBytes, productLogStoreMaxBytes } from '../src/queries/product-log-storage-policy';
import { findActiveJoinedDeployment } from '../src/queries/deployment-joined.query';
import type { DeploymentJoinedRow } from '../src/queries/deployments.query.types';
import { requestDeploymentKubeStop } from '../src/queries/deployment-kube-membership.query';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'deployment_kube_reference');
const apiConfig: ApiConfig = buildApiConfig(databaseUrl);
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);

describe('deployment Kubernetes transition persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool, setup: seedDeployment });

  it('serializes concurrent drift callbacks and writes one audit event', async (): Promise<void> => {
    const input: PersistDeploymentKubeTransitionInput = transitionInput('org_kube');
    const applied: boolean[] = await Promise.all([
      persistDeploymentKubeTransition(input),
      persistDeploymentKubeTransition(input),
    ]);
    const references: object[] = await db.select().from(deploymentKubeReferences);
    const events: object[] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'deployment.kubernetes.drift_detected'));
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ deploymentId: 'dep_kube', observedAt: null, state: 'pending' });
    expect(events).toHaveLength(1);
    expect(applied.filter((value: boolean): boolean => value)).toHaveLength(1);
    expect(applied.filter((value: boolean): boolean => !value)).toHaveLength(1);
    expect(events[0]).toMatchObject({ occurredAt: input.eventAt });
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

  it('keeps every stored line across the P2-style Pod replacement', async (): Promise<void> => {
    await seedCandidate();
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

    await expect(ingestDeploymentProductLogs([event!])).resolves.toEqual({ accepted: 0, duplicates: 0, rejected: 1 });
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

  it('rejects non-product container identities instead of guessing a deployment', async (): Promise<void> => {
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

  it('captures the legacy app container during the P7 cutover rollout', async (): Promise<void> => {
    const [event]: ProductLogIngestEvent[] = buildProductLogSequence(
      '44444444-4444-4444-8444-444444444444',
      'legacy',
      0,
      1,
    );
    expect(event).toBeDefined();
    await expect(
      ingestDeploymentProductLogs([{ ...event!, containerName: 'app', podName: 'app-dep-kube-oldpod' }]),
    ).resolves.toEqual({ accepted: 1, duplicates: 0, rejected: 0 });
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

  it('rolls back the state transition when drift audit persistence fails', async (): Promise<void> => {
    await expect(persistDeploymentKubeTransition(transitionInput('org_missing'))).rejects.toThrow();
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ deploymentId: 'dep_kube', state: 'active' });
  });

  it('orders same-millisecond callbacks by expected revision', async (): Promise<void> => {
    await db.update(deploymentKubeReferences).set({ state: 'pending' });
    const drift: PersistDeploymentKubeTransitionInput = { ...transitionInput('org_kube'), audit: null };
    const ready: PersistDeploymentKubeTransitionInput = {
      ...drift,
      audit: null,
      nextState: 'active',
      observedAt: drift.eventAt,
    };
    expect(await persistDeploymentKubeTransition(ready)).toBe(true);
    expect(await persistDeploymentKubeTransition(drift)).toBe(false);
    expect(
      await persistDeploymentKubeTransition({
        ...drift,
        audit: { kind: 'non-ready', message: 'Active Kubernetes Deployment became non-Ready.' },
        expectedRevision: 1,
      }),
    ).toBe(true);
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ revision: 2, state: 'pending', transitionedAt: drift.eventAt });
  });

  it('replays a same-millisecond Ready callback that lost the revision race', async (): Promise<void> => {
    await db.update(deploymentKubeReferences).set({ state: 'pending' });
    const pending: PersistDeploymentKubeTransitionInput = { ...transitionInput('org_kube'), audit: null };
    const ready: PersistDeploymentKubeTransitionInput = {
      ...pending,
      nextState: 'active',
      observedAt: pending.eventAt,
    };
    expect(await persistDeploymentKubeTransition(pending)).toBe(true);
    expect(await persistDeploymentKubeTransition(ready)).toBe(false);
    expect(await persistDeploymentKubeTransition({ ...ready, expectedRevision: 1 })).toBe(true);
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ observedAt: pending.eventAt, revision: 2, state: 'active' });
  });

  it('rejects illegal graph edges and an active drift transition without audit', async (): Promise<void> => {
    await expect(persistDeploymentKubeTransition({ ...transitionInput('org_kube'), audit: null })).rejects.toThrow(
      'invalid drift audit',
    );
    await db.update(deploymentKubeReferences).set({ state: 'desired' });
    await expect(
      persistDeploymentKubeTransition({ ...transitionInput('org_kube'), audit: null, nextState: 'active' }),
    ).rejects.toThrow('Invalid Kubernetes deployment transition');
  });

  it('refreshes observedAt for a stable active observation without drift audit', async (): Promise<void> => {
    const observedAt: Date = new Date('2026-07-11T12:00:00.000Z');
    expect(
      await persistDeploymentKubeTransition({
        ...transitionInput('org_kube'),
        audit: null,
        nextState: 'active',
        observedAt,
      }),
    ).toBe(true);
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ observedAt, revision: 1, state: 'active' });
  });

  it('keeps pending candidate inactive, ignores stale revisions, and preserves the active deployment on failure', async (): Promise<void> => {
    await seedCandidate();
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'pending',
        observedAt,
        revision: 0,
      }),
    ).toBe(true);
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'ready',
        observedAt,
        revision: 0,
      }),
    ).toBe(false);
    const beforeFailure: { id: string; isActive: boolean }[] = await db
      .select({ id: deployments.id, isActive: deployments.isActive })
      .from(deployments);
    expect(beforeFailure).toEqual(
      expect.arrayContaining([
        { id: 'dep_candidate', isActive: false },
        { id: 'dep_kube', isActive: true },
      ]),
    );
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: 'rollout failed',
        observation: 'failed',
        observedAt,
        revision: 1,
      }),
    ).toBe(true);
    const afterFailure: { id: string; isActive: boolean; status: string }[] = await db
      .select({ id: deployments.id, isActive: deployments.isActive, status: deployments.status })
      .from(deployments);
    expect(afterFailure).toEqual(
      expect.arrayContaining([
        { id: 'dep_candidate', isActive: false, status: 'failed' },
        { id: 'dep_kube', isActive: true, status: 'running' },
      ]),
    );
  });

  it('keeps the legacy active route attached until the Kubernetes candidate is Ready', async (): Promise<void> => {
    await seedCandidate();
    await db.update(deploymentRoutes).set({ deploymentId: 'dep_kube' });

    await prepareDeploymentReconcileReference({
      deploymentId: 'dep_candidate',
      deploymentName: 'app-env-kube-svc-kube',
      id: 'kref_candidate',
      imageRef: 'repo/kube@sha256:candidate',
      namespace: 'cpt-prj-kube',
      networkPolicyNames: [],
      routeId: 'route_kube',
      routeSubdomain: 'kube',
      serviceName: 'app-env-kube-svc-kube',
    });

    const [route] = await db.select({ deploymentId: deploymentRoutes.deploymentId }).from(deploymentRoutes);
    expect(route).toEqual({ deploymentId: 'dep_kube' });
  });

  it('returns an active deployment to pending with one drift audit', async (): Promise<void> => {
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: 'active pod missing',
        observation: 'pending',
        observedAt,
        revision: 0,
      }),
    ).toBe(true);
    const [reference] = await db.select().from(deploymentKubeReferences);
    const events: object[] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'deployment.kubernetes.drift_detected'));
    expect(reference).toMatchObject({ observedAt, revision: 1, state: 'pending' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetId: 'dep_kube' });
  });

  it('keeps a succeeded deployment claimable after active readiness drift', async (): Promise<void> => {
    await db.update(deployments).set({ status: 'succeeded' }).where(eq(deployments.id, 'dep_kube'));
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_kube',
      failureMessage: 'active pod missing',
      observation: 'pending',
      observedAt: new Date('2026-07-12T10:00:00.000Z'),
      revision: 0,
    });

    const claimed: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();

    expect(claimed?.candidate).toMatchObject({ deploymentId: 'dep_kube', state: 'pending' });
  });

  it('claims a requested stop and accepts the worker acknowledgement', async (): Promise<void> => {
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    await requestDeploymentKubeStop('dep_kube', new Date('2026-07-12T10:00:00.000Z'));

    const claimed: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();

    expect(claimed?.candidate).toMatchObject({ deploymentId: 'dep_kube', state: 'stopping' });
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: null,
        observation: 'stopped',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: claimed?.candidate.revision ?? -1,
      }),
    ).toBe(true);
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ revision: 2, state: 'stopped' });
  });

  it('promotes only after Ready and projects stable Kubernetes Service DNS on port 80', async (): Promise<void> => {
    await seedCandidate();
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'pending',
      observedAt,
      revision: 0,
    });
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'ready',
        observedAt,
        revision: 1,
      }),
    ).toBe(true);
    const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByHost(
      'kube.localhost',
      'localhost',
    );
    expect(route).toMatchObject({
      deploymentId: 'dep_candidate',
      upstreamHost: 'app-env-kube-svc-kube.cpt-prj-kube.svc.cluster.local',
      upstreamPort: 80,
    });
    const events: object[] = await db
      .select()
      .from(deploymentRunEvents)
      .where(eq(deploymentRunEvents.deploymentRunId, 'drn_candidate'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      deploymentId: 'dep_candidate',
      level: 'info',
      message: 'deployment completed',
      status: 'succeeded',
      stepKey: 'completed',
      stream: 'compartment',
    });
    const references: { deploymentId: string; state: string }[] = await db
      .select({ deploymentId: deploymentKubeReferences.deploymentId, state: deploymentKubeReferences.state })
      .from(deploymentKubeReferences);
    expect(references).toEqual(
      expect.arrayContaining([
        { deploymentId: 'dep_candidate', state: 'active' },
        { deploymentId: 'dep_kube', state: 'stopped' },
      ]),
    );
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    expect(await findNextDeploymentReconcilePair()).toMatchObject({
      candidate: { deploymentId: 'dep_candidate', state: 'active' },
    });
  });

  it('reattaches the stopped deployment route when a project start becomes Ready', async (): Promise<void> => {
    await seedCandidate();
    await db
      .update(deployments)
      .set({ isActive: false, promotionStage: 'stopped', status: 'stopped' })
      .where(eq(deployments.id, 'dep_kube'));
    await db
      .update(deploymentKubeReferences)
      .set({ state: 'stopped' })
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_kube'));
    await db.update(deploymentRoutes).set({ deploymentId: 'dep_kube' });
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');

    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'pending',
      observedAt,
      revision: 0,
    });
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'ready',
        observedAt,
        revision: 1,
      }),
    ).toBe(true);

    const [route] = await db.select({ deploymentId: deploymentRoutes.deploymentId }).from(deploymentRoutes);
    expect(route).toEqual({ deploymentId: 'dep_candidate' });
  });
});

function transitionInput(organizationId: string): PersistDeploymentKubeTransitionInput {
  return {
    audit: { kind: 'drifted', message: 'owned field changed' },
    deploymentId: 'dep_kube',
    environmentId: 'env_kube',
    eventAt: new Date('2026-07-11T12:00:00.000Z'),
    expectedRevision: 0,
    nextState: 'pending',
    observedAt: null,
    organizationId,
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
  };
}

async function seedDeployment(): Promise<void> {
  await db.insert(organizations).values({ id: 'org_kube', name: 'Kube', slug: 'kube' });
  await db.insert(nodes).values({
    id: 'node_kube',
    name: 'node-kube',
    nodeSocketPath: '/tmp/node-kube.sock',
    nodeUrl: '/tmp/node-kube.sock',
    nodeVersion: '1',
  });
  await db.insert(projects).values({ id: 'prj_kube', name: 'Kube', organizationId: 'org_kube' });
  await db.insert(projectServices).values({
    id: 'svc_kube',
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: 'prj_kube',
  });
  await db
    .insert(environments)
    .values({ id: 'env_kube', name: 'production', nodeId: 'node_kube', projectId: 'prj_kube' });
  await seedDeploymentRuntimeRows();
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_kube',
    deploymentName: 'app-dep-kube',
    id: 'kref_kube',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: ['app-dep-kube-default-deny'],
    serviceName: 'app-dep-kube',
  });
  await db
    .update(deploymentKubeReferences)
    .set({ state: 'active', transitionedAt: new Date('2026-07-11T10:00:00.000Z') });
}

async function seedDeploymentRuntimeRows(): Promise<void> {
  await db.insert(operations).values({
    id: 'op_kube',
    status: 'succeeded',
    summary: 'Deploy',
    targetId: 'dep_kube',
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_kube',
    imageRepository: 'repo/kube',
    imageRef: 'repo/kube@sha256:active',
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:kube',
  });
  await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_kube', triggerType: 'manual' });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_kube',
    deploymentRunId: 'drn_kube',
    environmentId: 'env_kube',
    health: 'healthy',
    id: 'dep_kube',
    isActive: true,
    nodeId: 'node_kube',
    operationId: 'op_kube',
    projectServiceId: 'svc_kube',
    promotionStage: 'active',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
}

async function seedCandidate(): Promise<void> {
  await db.insert(operations).values({
    id: 'op_candidate',
    status: 'running',
    summary: 'Deploy',
    targetId: 'dep_candidate',
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_candidate',
    imageRef: 'repo/kube@sha256:candidate',
    imageRepository: 'repo/kube',
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:candidate',
  });
  await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_candidate', triggerType: 'manual' });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_candidate',
    deploymentRunId: 'drn_candidate',
    environmentId: 'env_kube',
    health: 'pending',
    id: 'dep_candidate',
    isActive: false,
    nodeId: 'node_kube',
    operationId: 'op_candidate',
    projectServiceId: 'svc_kube',
    promotionStage: 'starting_candidate',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
  await db.insert(deploymentRoutes).values({
    accessScopeId: 'org_kube',
    accessScopeType: 'organization',
    deploymentId: 'dep_candidate',
    id: 'route_kube',
    subdomain: 'kube',
  });
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_candidate',
    deploymentName: 'app-env-kube-svc-kube',
    id: 'kref_candidate',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: [],
    serviceName: 'app-env-kube-svc-kube',
  });
}

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

function buildApiConfig(url: string): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 1,
    auditRetentionDays: 90,
    baseDomain: 'localhost',
    bindHost: '127.0.0.1',
    caddyTlsMode: 'internal',
    controlPlaneHost: 'compartment.localhost',
    customTlsDirectory: '/tmp/tls',
    databaseUrl: url,
    edgeToken: 'edge',
    edgeUrl: 'http://127.0.0.1:9081',
    logLevel: 'silent',
    nodeAgentSocketPath: '/tmp/node.sock',
    port: 9443,
    publicHttpPort: 9080,
    publicHttpsPort: 443,
    publicProtocol: 'http',
    resourceBackupDirectory: '/tmp/backups',
    rollbackRetentionLimit: null,
    runtimeControlToken: 'runtime',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    sessionSecret: 'secret',
    sessionTtlMs: 604_800_000,
    sourceArchiveDirectory: '/tmp/sources',
    sourceArchiveMaxBytes: 104_857_600,
    systemApiSocketPath: '/tmp/system.sock',
    systemToken: 'system',
    throttle: defaultApiAuthThrottleConfig,
    trustedOutboundHosts: [],
    variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
  };
}
