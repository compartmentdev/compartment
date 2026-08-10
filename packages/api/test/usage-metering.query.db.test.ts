import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveProcessScopedDatabaseUrl, readDatabaseTestMode } from '@compartment/test-support';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRuns,
  deployments,
  edgeTrafficUsageReceipts,
  environments,
  jobUsageCheckpoints,
  jobUsageHourly,
  operations,
  organizations,
  projectResources,
  projectServices,
  projects,
  workloadUsageCheckpoints,
  workloadUsageHourly,
} from '../src/db/schema';
import { parseVariablesMasterKey } from '../src/lib/variables-crypto';
import { appendDeploymentRunEvent } from '../src/queries/deployment-run-events.query';
import type { AppendDeploymentRunEventInput } from '../src/queries/deployment-run-events.query.types';
import { recordJobUsage } from '../src/queries/job-usage.query';
import type { RecordJobUsageInput } from '../src/queries/job-usage.query.types';
import type { ApiDatabaseTransaction } from '../src/db/client.types';
import { deleteExpiredUsageBatch, recordPodUsage } from '../src/queries/usage-metering.query';
import { publishEdgeTrafficMetrics } from '../src/services/usage-metering.service';
import type { PublishEdgeTrafficMetricsInput } from '../src/services/usage-metering.service.types';
import { useApiRuntimeDatabaseTestHarness } from './api-db-test.harness';
import { defaultApiAuthThrottleConfig } from './auth-throttle-config.fixture';
import { defaultAuditFileSinkConfig } from './audit-file-sink-config.fixture';

const { testDatabaseUrl } = readDatabaseTestMode();
const databaseUrl: string = deriveProcessScopedDatabaseUrl(testDatabaseUrl, 'usage_metering');
const pool: Pool = createDatabasePool(databaseUrl);
const db: Database = createDatabase(pool);
const apiConfig: ApiConfig = {
  auditFileSink: defaultAuditFileSinkConfig,
  auditRetentionCleanupBatchSize: 100,
  auditRetentionCleanupCron: '0 3 * * *',
  auditRetentionCleanupMaxBatches: 10,
  auditRetentionDays: 90,
  baseDomain: 'localhost',
  bindHost: '127.0.0.1',
  controlPlaneHost: 'console.localhost',
  databaseUrl,
  edgeToken: 'edge',
  edgeUrl: 'http://edge:9081',
  logLevel: 'silent',
  port: 9443,
  publicHttpPort: 9080,
  publicHttpsPort: 9443,
  publicProtocol: 'http',
  rollbackRetentionLimit: null,
  runtimeControlToken: 'runtime',
  sessionSecret: 'secret',
  sessionTtlMs: 1000,
  signupEnabled: false,
  sourceArchiveDirectory: '/tmp/source',
  sourceArchiveMaxBytes: 1000,
  systemApiSocketPath: '/tmp/system.sock',
  systemToken: 'system',
  throttle: defaultApiAuthThrottleConfig,
  tlsMode: 'internal',
  trustedOutboundHosts: [],
  usageMeteringIntervalMs: 60_000,
  usageRetentionDays: 400,
  tenantSecretsKek: parseVariablesMasterKey('11'.repeat(32)),
  variablesMasterKey: parseVariablesMasterKey('11'.repeat(32)),
};

describe('usage metering persistence', (): void => {
  useApiRuntimeDatabaseTestHarness({ apiConfig, databaseUrl, db, pool });

  beforeEach(async (): Promise<void> => {
    await db.insert(organizations).values({ id: 'org-usage', name: 'Usage', slug: 'usage' });
    await db.insert(projects).values({ id: 'prj-usage', name: 'usage', organizationId: 'org-usage' });
    await db.insert(environments).values({ id: 'env-usage', name: 'production', projectId: 'prj-usage' });
    await db
      .insert(projectServices)
      .values({ id: 'svc-usage', kind: 'web', name: 'web', path: '.', projectId: 'prj-usage' });
    await db.insert(operations).values({
      id: 'op-usage',
      status: 'running',
      summary: 'Deploy',
      targetId: 'dep-usage',
      targetType: 'deployment',
      type: 'deployment.create',
    });
    await db.insert(buildArtifacts).values({
      id: 'artifact-usage',
      imageRepository: 'registry.local/usage',
      projectId: 'prj-usage',
      projectServiceId: 'svc-usage',
      resolvedBuildEnvJson: '{}',
      resolvedBuildJson: '{}',
      sourceDigest: 'sha256:usage',
    });
    await db.insert(deploymentRuns).values({ environmentId: 'env-usage', id: 'run-usage', triggerType: 'manual' });
    await db.insert(deployments).values({
      buildArtifactId: 'artifact-usage',
      deploymentRunId: 'run-usage',
      environmentId: 'env-usage',
      health: 'ready',
      id: 'dep-usage',
      operationId: 'op-usage',
      projectServiceId: 'svc-usage',
      promotionStage: 'run',
      resolvedReadinessJson: 'null',
      resolvedRunJson: '{}',
      status: 'running',
    });
    await db.insert(deploymentKubeReferences).values({
      deploymentId: 'dep-usage',
      deploymentName: 'app-dep-usage',
      id: 'kube-ref-usage',
      namespace: 'cpt-prj-usage',
      networkPolicyNamesJson: '[]',
      serviceName: 'app-env-service',
      state: 'active',
    });
    await db.insert(projectResources).values({
      commandJson: '[]',
      envJson: '{}',
      environmentId: 'env-usage',
      id: 'res-usage',
      image: 'postgres:17',
      name: 'database',
      portsJson: '[]',
      readinessJson: 'null',
      runtimeDefinitionHash: 'resource-hash',
      status: 'running',
      volumesJson: '[]',
    });
  });

  it('migrates, increments hourly aggregates, and ignores replayed samples', async (): Promise<void> => {
    await recordSample('2026-07-29T12:59:30.000Z');
    await recordSample('2026-07-29T13:00:30.000Z');
    await recordSample('2026-07-29T13:00:30.000Z');
    await recordSample('2026-07-29T13:01:00.000Z');

    const rows: (typeof workloadUsageHourly.$inferSelect)[] = await db
      .select()
      .from(workloadUsageHourly)
      .where(eq(workloadUsageHourly.serviceId, 'svc-usage'))
      .orderBy(workloadUsageHourly.hourBucket);
    expect(rows).toMatchObject([
      { cpuMillicoreSeconds: 3000, memoryByteSeconds: 6000, sampleCount: 1 },
      { cpuMillicoreSeconds: 6000, memoryByteSeconds: 12000, sampleCount: 2 },
    ]);
  });

  it('does not invent usage after a missed collection window', async (): Promise<void> => {
    await recordSample('2026-07-29T12:00:00.000Z', 90_000);
    await recordSample('2026-07-29T12:02:00.000Z', 90_000);

    expect(await db.select().from(workloadUsageHourly)).toEqual([]);
  });

  it('deduplicates one source and sums two edge replicas across hour buckets', async (): Promise<void> => {
    const firstBatch: PublishEdgeTrafficMetricsInput = {
      batchId: 'batch-1',
      metrics: [
        {
          observedAt: new Date('2026-07-29T12:59:59.999Z'),
          requestBytes: 100,
          requestCount: 2,
          responseBytes: 200,
          status4xxCount: 1,
          status5xxCount: 0,
          upstreamHost: 'app-env-service.cpt-prj-usage.svc',
        },
      ],
      sourceId: 'edge-replica-1',
    };
    expect(await publishEdgeTrafficMetrics(firstBatch)).toBe('accepted');
    expect(await publishEdgeTrafficMetrics(firstBatch)).toBe('duplicate');
    expect(
      await publishEdgeTrafficMetrics({
        batchId: 'batch-1',
        metrics: [
          {
            observedAt: new Date('2026-07-29T12:59:59.999Z'),
            requestBytes: 50,
            requestCount: 1,
            responseBytes: 75,
            status4xxCount: 0,
            status5xxCount: 1,
            upstreamHost: 'app-env-service.cpt-prj-usage.svc',
          },
          {
            observedAt: new Date('2026-07-29T13:00:00.000Z'),
            requestBytes: 10,
            requestCount: 1,
            responseBytes: 20,
            status4xxCount: 0,
            status5xxCount: 0,
            upstreamHost: 'app-env-service.cpt-prj-usage.svc',
          },
        ],
        sourceId: 'edge-replica-2',
      }),
    ).toBe('accepted');

    const rows: (typeof workloadUsageHourly.$inferSelect)[] = await db
      .select()
      .from(workloadUsageHourly)
      .where(eq(workloadUsageHourly.serviceId, 'svc-usage'))
      .orderBy(workloadUsageHourly.hourBucket);
    expect(rows).toMatchObject([
      {
        hourBucket: new Date('2026-07-29T12:00:00.000Z'),
        requestBytes: 150,
        requestCount: 3,
        responseBytes: 275,
        status4xxCount: 1,
        status5xxCount: 1,
      },
      {
        hourBucket: new Date('2026-07-29T13:00:00.000Z'),
        requestBytes: 10,
        requestCount: 1,
        responseBytes: 20,
        status4xxCount: 0,
        status5xxCount: 0,
      },
    ]);
  });

  it('persists resource usage under the resource identity', async (): Promise<void> => {
    await recordResourceSample('2026-07-29T12:00:00.000Z');
    await recordResourceSample('2026-07-29T12:01:00.000Z');

    const [row] = await db.select().from(workloadUsageHourly).where(eq(workloadUsageHourly.resourceId, 'res-usage'));
    expect(row).toMatchObject({
      cpuMillicoreSeconds: 6000,
      memoryByteSeconds: 12000,
      resourceId: 'res-usage',
      sampleCount: 1,
      serviceId: null,
    });
  });

  it('increments job buckets once for a durable source key', async (): Promise<void> => {
    const input: RecordJobUsageInput = {
      completedAt: new Date('2026-07-29T13:00:30.000Z'),
      deploymentId: 'dep-usage',
      jobClass: 'build',
      sourceKey: 'build:dep-usage',
      startedAt: new Date('2026-07-29T12:59:30.000Z'),
    };
    await db.transaction(async (tx: ApiDatabaseTransaction): Promise<void> => await recordJobUsage(tx, input));
    await db.transaction(async (tx: ApiDatabaseTransaction): Promise<void> => await recordJobUsage(tx, input));

    const rows: (typeof jobUsageHourly.$inferSelect)[] = await db
      .select()
      .from(jobUsageHourly)
      .where(and(eq(jobUsageHourly.serviceId, 'svc-usage'), eq(jobUsageHourly.jobClass, 'build')))
      .orderBy(jobUsageHourly.hourBucket);
    expect(rows).toMatchObject([
      { durationSeconds: 30, jobCount: 0 },
      { durationSeconds: 30, jobCount: 1 },
    ]);
  });

  it('records build duration from terminal build events once', async (): Promise<void> => {
    await appendDeploymentRunEvent({
      createdAt: new Date('2026-07-29T12:59:30.000Z'),
      deploymentId: 'dep-usage',
      deploymentRunId: 'run-usage',
      id: 'event-build-running',
      level: 'info',
      message: 'Building',
      status: 'running',
      stepKey: 'building_image',
      stream: 'compartment',
    });
    const terminalEvent: Omit<AppendDeploymentRunEventInput, 'id'> = {
      createdAt: new Date('2026-07-29T13:00:30.000Z'),
      deploymentId: 'dep-usage',
      deploymentRunId: 'run-usage',
      level: 'info',
      message: 'Built',
      status: 'succeeded',
      stepKey: 'building_image',
      stream: 'compartment',
    };
    await appendDeploymentRunEvent({ ...terminalEvent, id: 'event-build-succeeded' });
    await appendDeploymentRunEvent({ ...terminalEvent, id: 'event-build-succeeded-retry' });

    const rows: (typeof jobUsageHourly.$inferSelect)[] = await db
      .select()
      .from(jobUsageHourly)
      .where(eq(jobUsageHourly.jobClass, 'build'))
      .orderBy(jobUsageHourly.hourBucket);
    expect(rows).toMatchObject([
      { durationSeconds: 30, jobCount: 0 },
      { durationSeconds: 30, jobCount: 1 },
    ]);
  });

  it('deletes expired aggregates and checkpoints in bounded batches', async (): Promise<void> => {
    await recordSample('2026-07-29T12:00:00.000Z');
    await recordSample('2026-07-29T12:01:00.000Z');
    await db.transaction(
      async (tx: ApiDatabaseTransaction): Promise<void> =>
        await recordJobUsage(tx, {
          completedAt: new Date('2026-07-29T12:01:00.000Z'),
          deploymentId: 'dep-usage',
          jobClass: 'release',
          sourceKey: 'release:dep-usage',
          startedAt: new Date('2026-07-29T12:00:00.000Z'),
        }),
    );

    const expiredAt: Date = new Date('2020-01-01T00:00:00.000Z');
    await db.update(workloadUsageHourly).set({ hourBucket: expiredAt });
    await db.insert(workloadUsageHourly).values({
      cpuMillicoreSeconds: 1,
      environmentId: 'env-usage',
      hourBucket: new Date('2019-01-01T00:00:00.000Z'),
      memoryByteSeconds: 1,
      organizationId: 'org-usage',
      projectId: 'prj-usage',
      sampleCount: 1,
      serviceId: 'svc-usage',
    });
    await db.update(jobUsageHourly).set({ hourBucket: expiredAt });
    await db.update(workloadUsageCheckpoints).set({ updatedAt: expiredAt });
    await db.update(jobUsageCheckpoints).set({ createdAt: expiredAt });
    await db
      .insert(edgeTrafficUsageReceipts)
      .values({ batchId: 'expired', createdAt: expiredAt, sourceId: 'edge-replica' });

    expect(
      await deleteExpiredUsageBatch({
        before: new Date('2021-01-01T00:00:00.000Z'),
        limit: 1,
      }),
    ).toBe(5);
    expect(await db.select().from(workloadUsageHourly)).toHaveLength(1);
    expect(await db.select().from(jobUsageHourly)).toEqual([]);
    expect(await db.select().from(workloadUsageCheckpoints)).toEqual([]);
    expect(await db.select().from(jobUsageCheckpoints)).toEqual([]);
    expect(
      await deleteExpiredUsageBatch({
        before: new Date('2021-01-01T00:00:00.000Z'),
        limit: 1,
      }),
    ).toBe(1);
    expect(await db.select().from(workloadUsageHourly)).toEqual([]);
  });
});

async function recordSample(observedAt: string, maximumIntervalMs: number = 120_000): Promise<void> {
  await recordPodUsage({
    maximumIntervalMs,
    pods: [
      {
        cpuMillicores: 100,
        deploymentId: 'dep-usage',
        kind: 'application',
        memoryBytes: 200,
        namespace: 'cmp-prj-usage',
        observedAt,
        podName: 'usage-pod',
        podUid: 'a95447df-c94a-4c1e-b7db-594a021bd93a',
      },
    ],
  });
}

async function recordResourceSample(observedAt: string): Promise<void> {
  await recordPodUsage({
    maximumIntervalMs: 120_000,
    pods: [
      {
        cpuMillicores: 100,
        kind: 'resource',
        memoryBytes: 200,
        namespace: 'cmp-prj-usage',
        observedAt,
        podName: 'resource-pod',
        podUid: '4ed7cda6-a8b6-44d4-b621-3beae5a01d76',
        resourceId: 'res-usage',
      },
    ],
  });
}
