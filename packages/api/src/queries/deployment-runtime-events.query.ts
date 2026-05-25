import { and, asc, eq, gte, inArray, or, type SQL } from 'drizzle-orm';
import type { DeploymentLogStream } from '@compartment/contracts';
import { getApiDatabase } from '../runtime/runtime-access';
import { deploymentRunEvents } from '../db/schema';
import type {
  DeploymentRuntimeEventRow,
  PersistedDeploymentRuntimeEventRow,
} from './deployment-runtime-events.query.types';

export async function listDeploymentRuntimeEvents(
  deploymentIds: string[],
  since: Date | undefined = undefined,
): Promise<DeploymentRuntimeEventRow[]> {
  if (deploymentIds.length === 0) {
    return [];
  }

  const rows: PersistedDeploymentRuntimeEventRow[] = await readDeploymentRuntimeEventRows(deploymentIds, since);

  return rows.flatMap((row: PersistedDeploymentRuntimeEventRow): DeploymentRuntimeEventRow[] => {
    const event: DeploymentRuntimeEventRow | null = toDeploymentRuntimeEventRow(row);
    return event === null ? [] : [event];
  });
}

async function readDeploymentRuntimeEventRows(
  deploymentIds: string[],
  since: Date | undefined,
): Promise<PersistedDeploymentRuntimeEventRow[]> {
  return since === undefined
    ? await readAllDeploymentRuntimeEventRows(deploymentIds)
    : await readDeploymentRuntimeEventRowsSince(deploymentIds, since);
}

async function readAllDeploymentRuntimeEventRows(
  deploymentIds: string[],
): Promise<PersistedDeploymentRuntimeEventRow[]> {
  return await getApiDatabase()
    .select()
    .from(deploymentRunEvents)
    .where(and(inArray(deploymentRunEvents.deploymentId, deploymentIds), deploymentLogEventPredicate()))
    .orderBy(asc(deploymentRunEvents.createdAt), asc(deploymentRunEvents.id));
}

async function readDeploymentRuntimeEventRowsSince(
  deploymentIds: string[],
  since: Date,
): Promise<PersistedDeploymentRuntimeEventRow[]> {
  return await getApiDatabase()
    .select()
    .from(deploymentRunEvents)
    .where(
      and(
        inArray(deploymentRunEvents.deploymentId, deploymentIds),
        deploymentLogEventPredicate(),
        gte(deploymentRunEvents.createdAt, since),
      ),
    )
    .orderBy(asc(deploymentRunEvents.createdAt), asc(deploymentRunEvents.id));
}

function deploymentLogEventPredicate(): SQL | undefined {
  return or(eq(deploymentRunEvents.stream, 'compartment'), eq(deploymentRunEvents.stepKey, 'release'));
}

function toDeploymentRuntimeEventRow(row: PersistedDeploymentRuntimeEventRow): DeploymentRuntimeEventRow | null {
  if (row.deploymentId === null) {
    return null;
  }

  return {
    createdAt: row.createdAt,
    deploymentId: row.deploymentId,
    id: row.id,
    message: row.message,
    stream: row.stream as DeploymentLogStream,
  };
}
