import type { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '../../test-support/src';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  auditEvents,
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRuns,
  deploymentRoutes,
  deployments,
  environments,
  nodes,
  operations,
  organizations,
  projectServices,
  projects,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import {
  persistDeploymentKubeTransition,
  upsertDeploymentKubeReference,
} from '../src/queries/deployment-kube-reference.query';
import type { PersistDeploymentKubeTransitionInput } from '../src/queries/deployment-kube-reference.query.types';
import {
  persistDeploymentReconcileObservation,
  prepareDeploymentReconcileReference,
} from '../src/queries/deployment-reconcile.query';
import { findActiveDeploymentRouteByHost } from '../src/queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';

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

function buildApiConfig(url: string): ApiConfig {
  return {
    auditFileSink: defaultAuditFileSinkConfig,
    auditRetentionCleanupBatchSize: 1_000,
    auditRetentionCleanupCron: '0 3 * * *',
    auditRetentionCleanupMaxBatches: 100,
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
