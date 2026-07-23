import { asc, eq, inArray } from 'drizzle-orm';
import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
} from '@compartment/contracts';
import { deploymentRunEvents } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  AppendDeploymentRunEventInput,
  DeploymentRunEventExecutor,
  DeploymentRunEventRow,
  PersistedDeploymentRunEventRow,
} from './deployment-run-events.query.types';

export async function appendDeploymentRunEvent(input: AppendDeploymentRunEventInput): Promise<void> {
  await appendDeploymentRunEventWithExecutor(getApiDatabase(), input);
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
