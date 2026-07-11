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
