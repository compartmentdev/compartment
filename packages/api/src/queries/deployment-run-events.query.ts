import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
} from '@compartment/contracts';
import { deploymentRunEvents } from '../db/schema';
import type { ApiDatabaseTransaction } from '../db/client.types';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AppendDeploymentRunEventInput,
  DeploymentRunEventExecutor,
  DeploymentRunEventRow,
  PersistedDeploymentRunEventRow,
} from './deployment-run-events.query.types';
import { recordJobUsage } from './job-usage.query';

export async function appendDeploymentRunEvent(input: AppendDeploymentRunEventInput): Promise<void> {
  await getApiDatabase().transaction(async (tx: ApiDatabaseTransaction): Promise<void> => {
    await appendDeploymentRunEventWithExecutor(tx, input);
    await recordBuildUsage(tx, input);
  });
}

async function recordBuildUsage(tx: ApiDatabaseTransaction, input: AppendDeploymentRunEventInput): Promise<void> {
  if (!isTerminalBuildEvent(input)) {
    return;
  }
  const startedAt: Date | null = await readBuildStartedAt(tx, input.deploymentId);
  if (startedAt === null) {
    return;
  }
  await recordJobUsage(tx, {
    completedAt: input.createdAt,
    deploymentId: input.deploymentId,
    jobClass: 'build',
    sourceKey: `build:${input.deploymentId}`,
    startedAt,
  });
}

function isTerminalBuildEvent(
  input: AppendDeploymentRunEventInput,
): input is AppendDeploymentRunEventInput & { deploymentId: string } {
  return (
    input.deploymentId !== null &&
    input.deploymentId !== undefined &&
    input.stepKey === 'building_image' &&
    (input.status === 'succeeded' || input.status === 'failed')
  );
}

async function readBuildStartedAt(tx: ApiDatabaseTransaction, deploymentId: string): Promise<Date | null> {
  const [started] = await tx
    .select({ createdAt: deploymentRunEvents.createdAt })
    .from(deploymentRunEvents)
    .where(
      and(
        eq(deploymentRunEvents.deploymentId, deploymentId),
        eq(deploymentRunEvents.stepKey, 'building_image'),
        eq(deploymentRunEvents.status, 'running'),
      ),
    )
    .orderBy(desc(deploymentRunEvents.createdAt))
    .limit(1);
  return started?.createdAt ?? null;
}

async function appendDeploymentRunEventWithExecutor(
  executor: DeploymentRunEventExecutor,
  input: AppendDeploymentRunEventInput,
): Promise<void> {
  await executor.insert(deploymentRunEvents).values({
    createdAt: input.createdAt,
    deploymentId: input.deploymentId ?? null,
    deploymentRunId: input.deploymentRunId,
    id: input.id,
    level: input.level,
    message: input.message,
    status: input.status ?? null,
    stepKey: input.stepKey,
    stream: input.stream,
  });
}

export async function listDeploymentRunEvents(deploymentRunId: string): Promise<DeploymentRunEventRow[]> {
  const rows: PersistedDeploymentRunEventRow[] = await getApiDatabase()
    .select()
    .from(deploymentRunEvents)
    .where(eq(deploymentRunEvents.deploymentRunId, deploymentRunId))
    .orderBy(asc(deploymentRunEvents.createdAt), asc(deploymentRunEvents.id));

  return rows.map(toDeploymentRunEventRow);
}

export async function listDeploymentRunEventsForRuns(deploymentRunIds: string[]): Promise<DeploymentRunEventRow[]> {
  if (deploymentRunIds.length === 0) {
    return [];
  }
  const rows: PersistedDeploymentRunEventRow[] = await getApiDatabase()
    .select()
    .from(deploymentRunEvents)
    .where(inArray(deploymentRunEvents.deploymentRunId, deploymentRunIds))
    .orderBy(asc(deploymentRunEvents.createdAt), asc(deploymentRunEvents.id));
  return rows.map(toDeploymentRunEventRow);
}

function toDeploymentRunEventRow(row: PersistedDeploymentRunEventRow): DeploymentRunEventRow {
  return {
    ...row,
    level: row.level as DeploymentRunLogLevel,
    status: row.status as DeploymentRunStepStatus | null,
    stepKey: row.stepKey as DeploymentRunStepKey,
    stream: row.stream as DeploymentLogStream,
  };
}
