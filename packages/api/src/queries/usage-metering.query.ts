import type { WorkerPodResourceMetric } from '@compartment/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  environments,
  jobUsageCheckpoints,
  jobUsageHourly,
  projectResources,
  projects,
  workloadUsageCheckpoints,
  workloadUsageHourly,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { readDeploymentUsageOwner } from './deployment-usage-owner.query';
import type { DeploymentUsageOwner } from './deployment-usage-owner.query.types';
import { splitUsageIntoHours } from './usage-aggregation.support';
import type { UsageHourSlice } from './usage-aggregation.support.types';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  DeleteExpiredUsageBatchInput,
  RecordPodUsageInput,
  UsageCheckpoint,
  UsageOwner,
} from './usage-metering.query.types';
import { deleteEdgeTrafficReceiptBatch } from './edge-traffic-metering.query';

export async function recordPodUsage(input: RecordPodUsageInput): Promise<void> {
  await getApiDatabase().transaction(async (tx: ApiDatabaseTransaction): Promise<void> => {
    const pods: WorkerPodResourceMetric[] = [
      ...new Map<string, WorkerPodResourceMetric>(
        input.pods.map((pod: WorkerPodResourceMetric): [string, WorkerPodResourceMetric] => [pod.podUid, pod]),
      ).values(),
    ].sort((left: WorkerPodResourceMetric, right: WorkerPodResourceMetric): number =>
      left.podUid.localeCompare(right.podUid),
    );
    for (const pod of pods) {
      await recordPodSample(tx, pod, input.maximumIntervalMs);
    }
  });
}

async function recordPodSample(
  tx: ApiDatabaseTransaction,
  pod: WorkerPodResourceMetric,
  maximumIntervalMs: number,
): Promise<void> {
  const observedAt: Date = new Date(pod.observedAt);
  const checkpoint: UsageCheckpoint | undefined = await readCheckpoint(tx, pod.podUid);
  if (checkpoint === undefined) {
    await tx.insert(workloadUsageCheckpoints).values({ observedAt, podUid: pod.podUid }).onConflictDoNothing();
    return;
  }
  const elapsedMs: number = observedAt.getTime() - checkpoint.observedAt.getTime();
  if (elapsedMs <= 0) {
    return;
  }
  await advanceCheckpoint(tx, pod.podUid, observedAt);
  if (elapsedMs > maximumIntervalMs) {
    return;
  }
  await recordElapsedUsage(tx, pod, checkpoint.observedAt, observedAt);
}

async function recordElapsedUsage(
  tx: ApiDatabaseTransaction,
  pod: WorkerPodResourceMetric,
  previousObservedAt: Date,
  observedAt: Date,
): Promise<void> {
  const owner: UsageOwner | null = await readUsageOwner(tx, pod);
  if (owner === null) {
    return;
  }
  const slices: UsageHourSlice[] = splitUsageIntoHours({
    cpuMillicores: pod.cpuMillicores,
    memoryBytes: pod.memoryBytes,
    observedAt,
    previousObservedAt,
  });
  for (const slice of slices) {
    await incrementUsageHour(tx, owner, slice);
  }
}

async function readCheckpoint(tx: ApiDatabaseTransaction, podUid: string): Promise<UsageCheckpoint | undefined> {
  return (
    await tx
      .select({ observedAt: workloadUsageCheckpoints.observedAt })
      .from(workloadUsageCheckpoints)
      .where(eq(workloadUsageCheckpoints.podUid, podUid))
      .for('update')
  )[0];
}

async function advanceCheckpoint(tx: ApiDatabaseTransaction, podUid: string, observedAt: Date): Promise<void> {
  await tx
    .update(workloadUsageCheckpoints)
    .set({ observedAt, updatedAt: new Date() })
    .where(eq(workloadUsageCheckpoints.podUid, podUid));
}

async function readUsageOwner(tx: ApiDatabaseTransaction, pod: WorkerPodResourceMetric): Promise<UsageOwner | null> {
  return pod.kind === 'application'
    ? await readApplicationUsageOwner(tx, pod.deploymentId)
    : await readResourceUsageOwner(tx, pod.resourceId);
}

async function readApplicationUsageOwner(tx: ApiDatabaseTransaction, deploymentId: string): Promise<UsageOwner | null> {
  const row: DeploymentUsageOwner | undefined = await readDeploymentUsageOwner(tx, deploymentId);
  return row === undefined ? null : { ...row, resourceId: null };
}

async function readResourceUsageOwner(tx: ApiDatabaseTransaction, resourceId: string): Promise<UsageOwner | null> {
  const [row] = await tx
    .select({
      environmentId: projectResources.environmentId,
      organizationId: projects.organizationId,
      projectId: environments.projectId,
      resourceId: projectResources.id,
    })
    .from(projectResources)
    .innerJoin(environments, eq(environments.id, projectResources.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(projectResources.id, resourceId))
    .limit(1);
  return row === undefined ? null : { ...row, serviceId: null };
}

async function incrementUsageHour(tx: ApiDatabaseTransaction, owner: UsageOwner, slice: UsageHourSlice): Promise<void> {
  const ownerColumn: typeof workloadUsageHourly.resourceId | typeof workloadUsageHourly.serviceId =
    owner.serviceId === null ? workloadUsageHourly.resourceId : workloadUsageHourly.serviceId;
  await tx
    .insert(workloadUsageHourly)
    .values({ ...owner, ...slice, sampleCount: 1 })
    .onConflictDoUpdate({
      set: {
        cpuMillicoreSeconds: sql`${workloadUsageHourly.cpuMillicoreSeconds} + ${slice.cpuMillicoreSeconds}`,
        memoryByteSeconds: sql`${workloadUsageHourly.memoryByteSeconds} + ${slice.memoryByteSeconds}`,
        sampleCount: sql`${workloadUsageHourly.sampleCount} + 1`,
        updatedAt: new Date(),
      },
      target: [
        workloadUsageHourly.organizationId,
        workloadUsageHourly.projectId,
        workloadUsageHourly.environmentId,
        ownerColumn,
        workloadUsageHourly.hourBucket,
      ],
      targetWhere: sql`${ownerColumn} is not null`,
    });
}

export async function deleteExpiredUsageBatch(input: DeleteExpiredUsageBatchInput): Promise<number> {
  const database: Database = getApiDatabase();
  const deleted: number[] = await Promise.all([
    deleteWorkloadUsageBatch(database, input),
    deleteJobUsageBatch(database, input),
    deleteWorkloadCheckpointBatch(database, input),
    deleteJobCheckpointBatch(database, input),
    deleteEdgeTrafficReceiptBatch(database, input),
  ]);
  return deleted.reduce((total: number, count: number): number => total + count, 0);
}

async function deleteWorkloadUsageBatch(database: Database, input: DeleteExpiredUsageBatchInput): Promise<number> {
  const result: { rowCount: number | null } = await database.execute(sql`
    with doomed as (
      select ctid from ${workloadUsageHourly}
      where ${workloadUsageHourly.hourBucket} < ${input.before} limit ${input.limit}
    )
    delete from ${workloadUsageHourly} where ctid in (select ctid from doomed)
  `);
  return result.rowCount ?? 0;
}

async function deleteJobUsageBatch(database: Database, input: DeleteExpiredUsageBatchInput): Promise<number> {
  const result: { rowCount: number | null } = await database.execute(sql`
    with doomed as (
      select ctid from ${jobUsageHourly}
      where ${jobUsageHourly.hourBucket} < ${input.before} limit ${input.limit}
    )
    delete from ${jobUsageHourly} where ctid in (select ctid from doomed)
  `);
  return result.rowCount ?? 0;
}

async function deleteWorkloadCheckpointBatch(database: Database, input: DeleteExpiredUsageBatchInput): Promise<number> {
  const result: { rowCount: number | null } = await database.execute(sql`
    with doomed as (
      select ctid from ${workloadUsageCheckpoints}
      where ${workloadUsageCheckpoints.updatedAt} < ${input.before} limit ${input.limit}
    )
    delete from ${workloadUsageCheckpoints} where ctid in (select ctid from doomed)
  `);
  return result.rowCount ?? 0;
}

async function deleteJobCheckpointBatch(database: Database, input: DeleteExpiredUsageBatchInput): Promise<number> {
  const result: { rowCount: number | null } = await database.execute(sql`
    with doomed as (
      select ctid from ${jobUsageCheckpoints}
      where ${jobUsageCheckpoints.createdAt} < ${input.before} limit ${input.limit}
    )
    delete from ${jobUsageCheckpoints} where ctid in (select ctid from doomed)
  `);
  return result.rowCount ?? 0;
}
