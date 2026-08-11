import type { Pool, PoolClient } from 'pg';
import { eq, inArray } from 'drizzle-orm';
import { createDatabasePool } from '../src/db/client';
import { describe, expect, it } from 'vitest';
import {
  auditEvents,
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRunEvents,
  deploymentRuns,
  deploymentRoutes,
  deployments,
  environmentResourceOutputVariableBindings,
  operations,
  projectKubeProvisioning,
  projectResources,
  projectServices,
} from '../src/db/schema';
import {
  findNextDeploymentReconcilePair,
  persistDeploymentReconcileObservation,
  prepareDeploymentReconcileReference,
} from '../src/queries/deployment-reconcile.query';
import type {
  DeploymentReconcilePair,
  PrepareDeploymentReconcileResult,
} from '../src/queries/deployment-reconcile.query.types';
import { findActiveDeploymentRouteByHost } from '../src/queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import { requestDeploymentKubeStop } from '../src/queries/deployment-kube-membership.query';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import { projectIsolationVersion } from '../src/queries/project-provisioning-policy';
import { claimPendingProjectProvisioning } from '../src/queries/project-provisioning.query';
import type { ProjectProvisioningClaimRow } from '../src/queries/project-provisioning.query.types';
import { upsertDeploymentKubeReference } from '../src/queries/deployment-kube-reference.query';
import {
  createDeploymentKubeReferenceDatabaseTestContext,
  seedCandidate,
  seedDeployment,
  useApiRuntimeDatabaseTestHarness,
} from './deployment-kube-reference.query.db.harness';

const { apiConfig, databaseUrl, db, pool } = createDeploymentKubeReferenceDatabaseTestContext(
  'deployment_kube_reference_reconcile',
);

const resourceConfigurationFingerprint: string = '0'.repeat(64);

describe('deployment Kubernetes transition persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({
    apiConfig,
    databaseUrl,
    db,
    pool,
    setup: async (): Promise<void> => await seedDeployment(db),
  });

  it('serializes concurrent drift callbacks and writes one audit event', async (): Promise<void> => {
    const observedAt: Date = new Date('2026-07-11T12:00:00.000Z');
    const applied: boolean[] = await Promise.all([
      persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: 'owned field changed',
        observation: 'pending',
        observedAt,
        revision: 0,
      }),
      persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: 'owned field changed',
        observation: 'pending',
        observedAt,
        revision: 0,
      }),
    ]);
    const references: object[] = await db.select().from(deploymentKubeReferences);
    const events: object[] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'deployment.kubernetes.drift_detected'));
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ deploymentId: 'dep_kube', observedAt, state: 'pending' });
    expect(events).toHaveLength(1);
    expect(applied.filter((value: boolean): boolean => value)).toHaveLength(1);
    expect(applied.filter((value: boolean): boolean => !value)).toHaveLength(1);
    expect(events[0]).toMatchObject({ occurredAt: observedAt });
  });

  it('keeps pending candidate inactive, ignores stale revisions, and preserves the active deployment on failure', async (): Promise<void> => {
    await seedCandidate(db);
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
    await seedCandidate(db);
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

  it('carries the resources the deployed application dials', async (): Promise<void> => {
    await seedDeclaredResource();
    await claimablePendingCandidate();

    await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
      candidate: { resourceEndpoints: [{ port: 5432, resourceId: 'res_kube', timeoutMs: 30_000 }] },
    });
  });

  it('carries no endpoint for a resource the operator stopped', async (): Promise<void> => {
    await seedDeclaredResource();
    await db.update(projectResources).set({ status: 'stopped' }).where(eq(projectResources.id, 'res_kube'));
    await claimablePendingCandidate();

    await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
      candidate: { resourceEndpoints: [] },
    });
  });

  it('carries no endpoint for a declared resource that publishes no readiness signal', async (): Promise<void> => {
    await seedDeclaredResource();
    await db.update(projectResources).set({ readinessJson: 'null' }).where(eq(projectResources.id, 'res_kube'));
    await claimablePendingCandidate();

    await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
      candidate: { resourceEndpoints: [] },
    });
  });

  it('does not orphan an active deployment when its recovery rollout exceeds the progress deadline', async (): Promise<void> => {
    await db.update(deployments).set({ status: 'succeeded' }).where(eq(deployments.id, 'dep_kube'));
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_kube',
      failureMessage: 'active pod missing',
      observation: 'pending',
      observedAt: new Date('2026-07-12T10:00:00.000Z'),
      revision: 0,
    });
    const recovery: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: 'Kubernetes rollout exceeded its progress deadline.',
        observation: 'failed',
        observedAt: new Date('2026-07-12T10:00:03.000Z'),
        revision: recovery?.candidate.revision ?? -1,
      }),
    ).toBe(true);

    const [deployment] = await db.select().from(deployments).where(eq(deployments.id, 'dep_kube'));
    expect(deployment).toMatchObject({ isActive: true, status: 'succeeded' });
    await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
      candidate: { deploymentId: 'dep_kube', state: 'pending' },
    });
  });

  it('recovers an active deployment without publishing a second completion event', async (): Promise<void> => {
    await db.insert(deploymentRunEvents).values({
      createdAt: new Date('2026-07-11T10:00:00.000Z'),
      deploymentId: 'dep_kube',
      deploymentRunId: 'drn_kube',
      id: 'drev_existing_completion',
      level: 'info',
      message: 'deployment completed',
      status: 'succeeded',
      stepKey: 'completed',
      stream: 'compartment',
    });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_kube',
      failureMessage: 'active pod missing',
      observation: 'pending',
      observedAt: new Date('2026-07-12T10:00:00.000Z'),
      revision: 0,
    });

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: null,
        observation: 'ready',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: 1,
      }),
    ).toBe(true);
    const events: (typeof deploymentRunEvents.$inferSelect)[] = await db
      .select()
      .from(deploymentRunEvents)
      .where(eq(deploymentRunEvents.deploymentId, 'dep_kube'));
    expect(
      events.filter(
        (event: typeof deploymentRunEvents.$inferSelect): boolean => event.message === 'deployment completed',
      ),
    ).toHaveLength(1);
    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ revision: 2, state: 'active' });
  });

  it('does not reconcile the active workload while its replacement claim is leased', async (): Promise<void> => {
    await seedCandidate(db);
    await db.update(deployments).set({ status: 'succeeded' }).where(eq(deployments.id, 'dep_kube'));
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });

    const replacement: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
    const duringReplacementLease: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();

    expect(replacement?.candidate).toMatchObject({ deploymentId: 'dep_candidate', state: 'desired' });
    expect(duringReplacementLease).toBeNull();
  });

  it('accepts the first desired apply acknowledgement after the lease is reclaimed', async (): Promise<void> => {
    await seedCandidate(db);
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    const firstClaim: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
    await db
      .update(deploymentKubeReferences)
      .set({ updatedAt: new Date(0) })
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    const reclaimed: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
    const observedAt: Date = new Date('2026-07-12T10:00:01.000Z');

    expect(firstClaim?.candidate).toMatchObject({ deploymentId: 'dep_candidate', state: 'desired' });
    expect(reclaimed?.candidate).toMatchObject({ deploymentId: 'dep_candidate', state: 'desired' });
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'pending',
        observedAt,
        revision: firstClaim?.candidate.revision ?? -1,
      }),
    ).toBe(true);
    const [reference] = await db
      .select()
      .from(deploymentKubeReferences)
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    expect(reference).toMatchObject({ observedAt, state: 'pending' });
    expect(reference?.revision).toBeGreaterThan(reclaimed?.candidate.revision ?? Number.MAX_SAFE_INTEGER);
  });

  it('accepts a desired apply acknowledgement after repeated lease reclaims', async (): Promise<void> => {
    await seedCandidate(db);
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    const firstClaim: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();

    for (let reclaim: number = 0; reclaim < 5; reclaim += 1) {
      await db
        .update(deploymentKubeReferences)
        .set({ updatedAt: new Date(0) })
        .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
      await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
        candidate: { deploymentId: 'dep_candidate', state: 'desired' },
      });
    }

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'pending',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: firstClaim?.candidate.revision ?? -1,
      }),
    ).toBe(true);
    const [reference] = await db
      .select()
      .from(deploymentKubeReferences)
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    expect(reference).toMatchObject({ state: 'pending' });
  });

  it('rejects a stale pending acknowledgement after the reference leaves desired state', async (): Promise<void> => {
    await seedCandidate(db);

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'pending',
        observedAt: new Date('2026-07-12T10:00:00.000Z'),
        revision: 0,
      }),
    ).toBe(true);
    const [referenceAfterFirstAcknowledgement] = await db
      .select()
      .from(deploymentKubeReferences)
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    expect(referenceAfterFirstAcknowledgement).toMatchObject({ state: 'pending' });
    expect(referenceAfterFirstAcknowledgement?.revision).toBeGreaterThan(0);

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'pending',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: 0,
      }),
    ).toBe(false);
    const [referenceAfterStaleAcknowledgement] = await db
      .select()
      .from(deploymentKubeReferences)
      .where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    expect(referenceAfterStaleAcknowledgement?.revision).toBe(referenceAfterFirstAcknowledgement?.revision);
  });

  it('fails a waiting deployment when project provisioning reaches its attempt cap', async (): Promise<void> => {
    await db.update(deploymentKubeReferences).set({ state: 'desired' });
    await db.update(operations).set({ status: 'running' }).where(eq(operations.id, 'op_kube'));
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'pending' });

    for (let attempt: number = 1; attempt <= 3; attempt += 1) {
      const claimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning(
        resourceConfigurationFingerprint,
      );
      expect(claimed).toMatchObject({ projectId: 'prj_kube', projectName: 'Kube' });
      await completeProjectProvisioning({
        action: 'provision',
        failureMessage: `namespace provisioning attempt ${attempt} failed`,
        isolationVersion: claimed?.isolationVersion ?? 1,
        leaseId: claimed?.leaseId ?? '',
        projectId: 'prj_kube',
        status: 'failed',
      });
      await db
        .update(projectKubeProvisioning)
        .set({ updatedAt: new Date(0) })
        .where(eq(projectKubeProvisioning.projectId, 'prj_kube'));
    }

    await expect(claimPendingProjectProvisioning(resourceConfigurationFingerprint)).resolves.toBeNull();
    const [deployment] = await db.select().from(deployments).where(eq(deployments.id, 'dep_kube'));
    const [operation] = await db.select().from(operations).where(eq(operations.id, 'op_kube'));
    expect(deployment).toMatchObject({ health: 'unhealthy', status: 'failed' });
    expect(deployment?.failureMessage).toContain('namespace provisioning attempt 3 failed');
    expect(operation).toMatchObject({ status: 'failed' });
    expect(operation?.summary).toContain('namespace provisioning attempt 3 failed');
    const failedEvents: (typeof deploymentRunEvents.$inferSelect)[] = await db
      .select()
      .from(deploymentRunEvents)
      .where(eq(deploymentRunEvents.deploymentId, 'dep_kube'));
    expect(failedEvents).toEqual([
      expect.objectContaining({ level: 'error', status: 'failed', stepKey: 'provisioning' }),
    ]);
    await expect(findNextDeploymentReconcilePair()).resolves.toBeNull();

    await seedCandidate(db);
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
    await expect(findNextDeploymentReconcilePair()).resolves.toBeNull();
    const [futureDeployment] = await db.select().from(deployments).where(eq(deployments.id, 'dep_candidate'));
    const [futureOperation] = await db.select().from(operations).where(eq(operations.id, 'op_candidate'));
    expect(futureDeployment).toMatchObject({ health: 'unhealthy', status: 'failed' });
    expect(futureDeployment?.failureMessage).toContain('namespace provisioning attempt 3 failed');
    expect(futureOperation).toMatchObject({ status: 'failed' });
  });

  it('serializes terminal provisioning with preparation of future deployment work', async (): Promise<void> => {
    await seedCandidate(db);
    await db
      .insert(projectKubeProvisioning)
      .values({ isolationVersion: projectIsolationVersion, projectId: 'prj_kube', state: 'succeeded' });
    const holderPool: Pool = createDatabasePool(databaseUrl);
    const holder: PoolClient = await holderPool.connect();
    let preparation: Promise<PrepareDeploymentReconcileResult> | null = null;
    try {
      await holder.query('begin');
      await holder.query(
        `update project_kube_provisioning
         set attempts = 3, failure_message = 'terminal namespace failure', state = 'failed'
         where project_id = 'prj_kube'`,
      );
      preparation = prepareDeploymentReconcileReference({
        deploymentId: 'dep_candidate',
        deploymentName: 'app-env-kube-svc-kube',
        id: 'kref_concurrent_terminal',
        imageRef: 'repo/kube@sha256:concurrent-terminal',
        namespace: 'cpt-prj-kube',
        networkPolicyNames: [],
        routeId: 'route_kube',
        routeSubdomain: 'kube',
        serviceName: 'app-env-kube-svc-kube',
      });
      await Promise.race([
        preparation.then((): never => {
          throw new Error('Expected deployment preparation to wait for the terminal provisioning transaction.');
        }),
        waitForDatabaseBlocker(holder),
      ]);
      await holder.query('commit');
      await preparation;

      const [deployment] = await db.select().from(deployments).where(eq(deployments.id, 'dep_candidate'));
      expect(deployment).toMatchObject({ status: 'failed' });
      expect(deployment?.failureMessage).toContain('terminal namespace failure');
    } finally {
      await holder.query('rollback');
      await Promise.allSettled(preparation === null ? [] : [preparation]);
      holder.release();
      await holderPool.end();
    }
  }, 10_000);

  it('serializes deployment preparation with project archival', async (): Promise<void> => {
    await seedCandidate(db);
    await db.delete(deploymentKubeReferences).where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate'));
    await db
      .insert(projectKubeProvisioning)
      .values({ isolationVersion: projectIsolationVersion, projectId: 'prj_kube', state: 'succeeded' });
    const holderPool: Pool = createDatabasePool(databaseUrl);
    const holder: PoolClient = await holderPool.connect();
    let preparation: Promise<PrepareDeploymentReconcileResult> | null = null;
    try {
      await holder.query('begin');
      await holder.query(`update projects set archived_at = now() where id = 'prj_kube'`);
      preparation = prepareDeploymentReconcileReference({
        deploymentId: 'dep_candidate',
        deploymentName: 'app-env-kube-svc-kube',
        id: 'kref_concurrent_archive',
        imageRef: 'repo/kube@sha256:concurrent-archive',
        namespace: 'cpt-prj-kube',
        networkPolicyNames: [],
        routeId: 'route_concurrent_archive',
        routeSubdomain: 'kube',
        serviceName: 'app-env-kube-svc-kube',
      });
      await Promise.race([
        preparation.then((): never => {
          throw new Error('Expected deployment preparation to wait for the project archive transaction.');
        }),
        waitForDatabaseBlocker(holder),
      ]);
      await holder.query('commit');
      expect(await preparation).toBe('project-archived');

      await expect(
        db.select().from(deploymentKubeReferences).where(eq(deploymentKubeReferences.deploymentId, 'dep_candidate')),
      ).resolves.toEqual([]);
      await expect(findNextDeploymentReconcilePair()).resolves.toBeNull();
    } finally {
      await holder.query('rollback');
      await Promise.allSettled(preparation === null ? [] : [preparation]);
      holder.release();
      await holderPool.end();
    }
  }, 10_000);

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
    expect(reference).toMatchObject({ revision: 3, state: 'stopped' });
  });

  it('rejects an in-flight observation after a stop request advances the revision', async (): Promise<void> => {
    await db.update(deployments).set({ status: 'succeeded' }).where(eq(deployments.id, 'dep_kube'));
    await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
    const inFlight: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
    expect(inFlight?.candidate).toMatchObject({ deploymentId: 'dep_kube', revision: 1, state: 'active' });

    await requestDeploymentKubeStop('dep_kube', new Date('2026-07-12T10:00:00.000Z'));
    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_kube',
        failureMessage: 'stale non-ready observation',
        observation: 'pending',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: inFlight?.candidate.revision ?? -1,
      }),
    ).toBe(false);

    const [reference] = await db.select().from(deploymentKubeReferences);
    expect(reference).toMatchObject({ revision: 2, state: 'stopping' });
    await expect(findNextDeploymentReconcilePair()).resolves.toMatchObject({
      candidate: { deploymentId: 'dep_kube', revision: 3, state: 'stopping' },
    });
  });

  it('promotes only after Ready and projects stable Kubernetes Service DNS on port 80', async (): Promise<void> => {
    await seedCandidate(db);
    const observedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'pending',
      observedAt,
      revision: 0,
    });
    const [routeBeforeReady] = await db
      .select({
        accessScopeId: deploymentRoutes.accessScopeId,
        accessScopeType: deploymentRoutes.accessScopeType,
        deploymentId: deploymentRoutes.deploymentId,
      })
      .from(deploymentRoutes);
    expect(routeBeforeReady).toEqual({
      accessScopeId: 'org_kube',
      accessScopeType: 'organization',
      deploymentId: 'dep_candidate',
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
      accessScopeId: 'env_kube',
      accessScopeType: 'environment',
      deploymentId: 'dep_candidate',
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
    const [operation] = await db.select().from(operations).where(eq(operations.id, 'op_candidate'));
    expect(operation).toMatchObject({ completedAt: observedAt, status: 'succeeded' });
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

  it('reattaches a route reserved by a failed rollout to the next Ready deployment', async (): Promise<void> => {
    await seedCandidate(db);
    const failedAt: Date = new Date('2026-07-12T10:00:00.000Z');
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'pending',
      observedAt: failedAt,
      revision: 0,
    });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: 'readiness failed',
      observation: 'failed',
      observedAt: failedAt,
      revision: 1,
    });
    await db
      .update(deploymentRoutes)
      .set({ updatedAt: new Date('2026-07-12T10:00:03.000Z') })
      .where(eq(deploymentRoutes.id, 'route_kube'));
    await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_decoy', triggerType: 'manual' });
    await db.insert(deployments).values({
      accessMode: 'authenticated',
      buildArtifactId: 'bar_candidate',
      completedAt: failedAt,
      createdAt: new Date('2026-07-12T10:00:02.000Z'),
      deploymentRunId: 'drn_decoy',
      environmentId: 'env_kube',
      health: 'unhealthy',
      id: 'dep_failed_decoy',
      isActive: false,
      operationId: 'op_candidate',
      projectServiceId: 'svc_kube',
      promotionStage: 'release',
      resolvedPortsJson: '[3000]',
      resolvedReadinessJson: '[]',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      status: 'failed',
    });
    await db.insert(deploymentRoutes).values({
      accessScopeId: 'org_kube',
      accessScopeType: 'organization',
      deploymentId: 'dep_failed_decoy',
      id: 'route_failed_decoy',
      subdomain: 'failed-decoy',
      updatedAt: new Date('2026-07-12T10:00:03.000Z'),
    });
    await seedRedeploymentAfterFailure();

    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_redeploy',
      failureMessage: null,
      observation: 'pending',
      observedAt: failedAt,
      revision: 0,
    });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_redeploy',
      failureMessage: null,
      observation: 'ready',
      observedAt: new Date('2026-07-12T10:00:01.000Z'),
      revision: 1,
    });

    const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByHost(
      'kube.localhost',
      'localhost',
    );
    expect(route).toMatchObject({ deploymentId: 'dep_redeploy' });
    const [active] = await db.select({ id: deployments.id }).from(deployments).where(eq(deployments.isActive, true));
    expect(active).toEqual({ id: 'dep_redeploy' });
  });

  it('terminalizes both operations when every deployment in a two-service run is Ready', async (): Promise<void> => {
    await seedTwoServiceCandidateRun();
    const firstReadyAt: Date = new Date('2026-07-12T10:00:01.000Z');
    const secondReadyAt: Date = new Date('2026-07-12T10:00:02.000Z');

    await markTwoServiceCandidateRunPending();
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'ready',
      observedAt: firstReadyAt,
      revision: 1,
    });
    const [firstOperationBeforeCompletion] = await db
      .select({ status: operations.status })
      .from(operations)
      .where(eq(operations.id, 'op_candidate'));
    expect(firstOperationBeforeCompletion).toEqual({ status: 'running' });

    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_backoffice',
      failureMessage: null,
      observation: 'ready',
      observedAt: secondReadyAt,
      revision: 1,
    });

    const runOperations: { completedAt: Date | null; id: string; status: string }[] = await db
      .select({ completedAt: operations.completedAt, id: operations.id, status: operations.status })
      .from(operations);
    expect(runOperations).toEqual(
      expect.arrayContaining([
        { completedAt: secondReadyAt, id: 'op_candidate', status: 'succeeded' },
        { completedAt: secondReadyAt, id: 'op_backoffice', status: 'succeeded' },
      ]),
    );
    const summaries: { summary: string }[] = await db
      .select({ summary: operations.summary })
      .from(operations)
      .where(inArray(operations.id, ['op_backoffice', 'op_candidate']))
      .orderBy(operations.id);
    expect(summaries.map(({ summary }: { summary: string }): string => summary)).toEqual([
      'Deployment dep_backoffice is active in Kubernetes',
      'Deployment dep_candidate is active in Kubernetes',
    ]);
  });

  it('serializes concurrent Ready observations and uses the latest service completion time', async (): Promise<void> => {
    await seedTwoServiceCandidateRun();
    const completedAt: Date = new Date('2026-07-12T10:00:02.000Z');
    await markTwoServiceCandidateRunPending();

    const holderPool: Pool = createDatabasePool(databaseUrl);
    const holder: PoolClient = await holderPool.connect();
    let readyObservations: Promise<boolean[]> | undefined;
    try {
      await holder.query('begin');
      await holder.query("select id from deployment_runs where id = 'drn_candidate' for update");
      readyObservations = Promise.all([
        persistDeploymentReconcileObservation({
          deploymentId: 'dep_candidate',
          failureMessage: null,
          observation: 'ready',
          observedAt: completedAt,
          revision: 1,
        }),
        persistDeploymentReconcileObservation({
          deploymentId: 'dep_backoffice',
          failureMessage: null,
          observation: 'ready',
          observedAt: new Date('2026-07-12T10:00:01.000Z'),
          revision: 1,
        }),
      ]);
      await Promise.race([
        readyObservations.then((): never => {
          throw new Error('Expected Ready observations to wait for the deployment run transaction.');
        }),
        waitForDatabaseBlocker(holder),
      ]);
      await holder.query('commit');
      expect(await readyObservations).toEqual([true, true]);
    } finally {
      await holder.query('rollback');
      if (readyObservations !== undefined) {
        await Promise.allSettled([readyObservations]);
      }
      holder.release();
      await holderPool.end();
    }

    const runOperations: { completedAt: Date | null; status: string }[] = await db
      .select({ completedAt: operations.completedAt, status: operations.status })
      .from(operations)
      .where(eq(operations.targetId, 'env_kube'));
    expect(runOperations).toEqual([
      { completedAt, status: 'succeeded' },
      { completedAt, status: 'succeeded' },
    ]);
  }, 15_000);

  it('fails every operation in a multi-service run when one service fails readiness', async (): Promise<void> => {
    await seedTwoServiceCandidateRun();
    const failedAt: Date = new Date('2026-07-12T10:00:01.000Z');
    await markTwoServiceCandidateRunPending();
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: 'readiness failed',
      observation: 'failed',
      observedAt: failedAt,
      revision: 1,
    });
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_backoffice',
      failureMessage: null,
      observation: 'ready',
      observedAt: new Date('2026-07-12T10:00:02.000Z'),
      revision: 1,
    });

    const runOperations: { completedAt: Date | null; status: string }[] = await db
      .select({ completedAt: operations.completedAt, status: operations.status })
      .from(operations)
      .where(eq(operations.targetId, 'env_kube'));
    expect(runOperations).toEqual([
      { completedAt: failedAt, status: 'failed' },
      { completedAt: failedAt, status: 'failed' },
    ]);
  });

  it('switches only the route bound to the exact previous active deployment', async (): Promise<void> => {
    await seedCandidate(db);
    await db.delete(deploymentRoutes).where(eq(deploymentRoutes.id, 'route_kube'));
    await db.insert(deployments).values({
      accessMode: 'authenticated',
      buildArtifactId: 'bar_kube',
      deploymentRunId: 'drn_kube',
      environmentId: 'env_kube',
      health: 'healthy',
      id: 'dep_decoy',
      isActive: false,
      operationId: 'op_kube',
      projectServiceId: 'svc_kube',
      promotionStage: 'stopped',
      resolvedPortsJson: '[3000]',
      resolvedReadinessJson: '[]',
      resolvedRoutesJson: '[]',
      resolvedRunJson: '{}',
      status: 'stopped',
    });
    await db.insert(deploymentRoutes).values([
      {
        accessScopeId: 'org_kube',
        accessScopeType: 'organization',
        deploymentId: 'dep_decoy',
        id: 'route_aaa_decoy',
        subdomain: 'decoy-kube',
      },
      {
        accessScopeId: 'org_kube',
        accessScopeType: 'organization',
        deploymentId: 'dep_kube',
        id: 'route_zzz_active',
        subdomain: 'active-kube',
      },
    ]);
    await persistDeploymentReconcileObservation({
      deploymentId: 'dep_candidate',
      failureMessage: null,
      observation: 'pending',
      observedAt: new Date('2026-07-12T10:00:00.000Z'),
      revision: 0,
    });

    expect(
      await persistDeploymentReconcileObservation({
        deploymentId: 'dep_candidate',
        failureMessage: null,
        observation: 'ready',
        observedAt: new Date('2026-07-12T10:00:01.000Z'),
        revision: 1,
      }),
    ).toBe(true);
    const routes: { deploymentId: string; id: string }[] = await db
      .select({ deploymentId: deploymentRoutes.deploymentId, id: deploymentRoutes.id })
      .from(deploymentRoutes);
    expect(routes).toEqual(
      expect.arrayContaining([
        { deploymentId: 'dep_decoy', id: 'route_aaa_decoy' },
        { deploymentId: 'dep_candidate', id: 'route_zzz_active' },
      ]),
    );
  });

  it('reattaches the stopped deployment route when a project start becomes Ready', async (): Promise<void> => {
    await seedCandidate(db);
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

async function waitForDatabaseBlocker(client: PoolClient): Promise<void> {
  const deadline: number = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result: { rows: { blockedCount: number }[] } = await client.query(
      `select count(*)::int as "blockedCount" from pg_stat_activity activity where activity.datname = current_database() and pg_backend_pid() = any(pg_blocking_pids(activity.pid))`,
    );
    if ((result.rows[0]?.blockedCount ?? 0) >= 1) {
      return;
    }
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for deployment preparation to block on the provisioning transaction.');
}

async function seedRedeploymentAfterFailure(): Promise<void> {
  await db.insert(operations).values({
    id: 'op_redeploy',
    status: 'running',
    summary: 'Deploy',
    targetId: 'env_kube',
    targetType: 'environment',
    type: 'deployment.run',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_redeploy',
    imageRef: 'repo/kube@sha256:redeploy',
    imageRepository: 'repo/kube',
    projectId: 'prj_kube',
    projectServiceId: 'svc_kube',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:redeploy',
  });
  await db.insert(deploymentRuns).values({ environmentId: 'env_kube', id: 'drn_redeploy', triggerType: 'manual' });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_redeploy',
    deploymentRunId: 'drn_redeploy',
    environmentId: 'env_kube',
    health: 'pending',
    id: 'dep_redeploy',
    isActive: false,
    operationId: 'op_redeploy',
    projectServiceId: 'svc_kube',
    promotionStage: 'release',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_redeploy',
    deploymentName: 'app-env-kube-svc-kube',
    id: 'kref_redeploy',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: [],
    serviceName: 'app-env-kube-svc-kube',
  });
}

async function seedTwoServiceCandidateRun(): Promise<void> {
  await seedCandidate(db);
  await db.update(operations).set({ targetId: 'env_kube' }).where(eq(operations.id, 'op_candidate'));
  await db.insert(projectServices).values({
    id: 'svc_backoffice',
    kind: 'api',
    name: 'backoffice',
    path: './backoffice',
    projectId: 'prj_kube',
  });
  await db.insert(operations).values({
    id: 'op_backoffice',
    status: 'running',
    summary: 'Deploy',
    targetId: 'env_kube',
    targetType: 'environment',
    type: 'deployment.run',
  });
  await db.insert(buildArtifacts).values({
    id: 'bar_backoffice',
    imageRef: 'repo/backoffice@sha256:candidate',
    imageRepository: 'repo/backoffice',
    projectId: 'prj_kube',
    projectServiceId: 'svc_backoffice',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{}',
    sourceDigest: 'sha256:backoffice',
  });
  await db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_backoffice',
    deploymentRunId: 'drn_candidate',
    environmentId: 'env_kube',
    health: 'pending',
    id: 'dep_backoffice',
    isActive: false,
    operationId: 'op_backoffice',
    projectServiceId: 'svc_backoffice',
    promotionStage: 'release',
    resolvedPortsJson: '[3000]',
    resolvedReadinessJson: '[]',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{}',
    status: 'running',
  });
  await db.insert(deploymentRoutes).values({
    accessScopeId: 'org_kube',
    accessScopeType: 'organization',
    deploymentId: 'dep_backoffice',
    id: 'route_backoffice',
    subdomain: 'backoffice-kube',
  });
  await upsertDeploymentKubeReference({
    deploymentId: 'dep_backoffice',
    deploymentName: 'app-env-kube-svc-backoffice',
    id: 'kref_backoffice',
    namespace: 'cpt-prj-kube',
    networkPolicyNames: [],
    serviceName: 'app-env-kube-svc-backoffice',
  });
}

async function markTwoServiceCandidateRunPending(): Promise<void> {
  for (const deploymentId of ['dep_candidate', 'dep_backoffice']) {
    await persistDeploymentReconcileObservation({
      deploymentId,
      failureMessage: null,
      observation: 'pending',
      observedAt: new Date('2026-07-12T10:00:00.000Z'),
      revision: 0,
    });
  }
}

/** The descriptor output binding is the only record that a service declares a resource. */
async function seedDeclaredResource(): Promise<void> {
  await db.insert(projectResources).values({
    commandJson: '[]',
    envJson: '[]',
    environmentId: 'env_kube',
    id: 'res_kube',
    image: 'postgres:17',
    name: 'postgres',
    portsJson: '[5432]',
    readinessJson: JSON.stringify({ port: 5432, timeoutMs: 30_000, type: 'tcp' }),
    runtimeDefinitionHash: 'runtime-hash',
    status: 'running',
    volumesJson: '[]',
  });
  await db.insert(environmentResourceOutputVariableBindings).values({
    environmentId: 'env_kube',
    id: 'binding_kube',
    keyName: 'DATABASE_URL',
    outputName: 'connection-url',
    resourceName: 'postgres',
    source: 'descriptor',
    targetServiceName: 'web',
  });
}

async function claimablePendingCandidate(): Promise<void> {
  await db.update(deployments).set({ status: 'succeeded' }).where(eq(deployments.id, 'dep_kube'));
  await db.insert(projectKubeProvisioning).values({ projectId: 'prj_kube', state: 'succeeded' });
  await persistDeploymentReconcileObservation({
    deploymentId: 'dep_kube',
    failureMessage: 'active pod missing',
    observation: 'pending',
    observedAt: new Date('2026-07-12T10:00:00.000Z'),
    revision: 0,
  });
}
