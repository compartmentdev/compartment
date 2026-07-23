import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import type { DeploymentRunLogLevel, DeploymentRunStepKey, DeploymentRunStepStatus } from '@compartment/contracts';
import { deploymentKubeReferences, deploymentRunEvents } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  DeploymentKubePhaseReference,
  DeploymentPhaseEventDatabaseRow,
  DeploymentPhaseEventRow,
} from './deployment-phase.query.types';

export async function listDeploymentKubePhaseReferences(
  deploymentIds: string[],
): Promise<DeploymentKubePhaseReference[]> {
  if (deploymentIds.length === 0) {
    return [];
  }
  return await getApiDatabase()
    .select({
      deploymentId: deploymentKubeReferences.deploymentId,
      state: deploymentKubeReferences.state,
    })
    .from(deploymentKubeReferences)
    .where(inArray(deploymentKubeReferences.deploymentId, deploymentIds));
}

export async function listDeploymentPhaseEvents(deploymentRunIds: string[]): Promise<DeploymentPhaseEventRow[]> {
  if (deploymentRunIds.length === 0) {
    return [];
  }
  const rows: DeploymentPhaseEventDatabaseRow[] = await queryDeploymentPhaseEvents(deploymentRunIds);
  return rows.map(toDeploymentPhaseEventRow);
}

async function queryDeploymentPhaseEvents(deploymentRunIds: string[]): Promise<DeploymentPhaseEventDatabaseRow[]> {
  return await getApiDatabase()
    .select({
      createdAt: deploymentRunEvents.createdAt,
      deploymentId: deploymentRunEvents.deploymentId,
      deploymentRunId: deploymentRunEvents.deploymentRunId,
      id: deploymentRunEvents.id,
      level: deploymentRunEvents.level,
      message: deploymentRunEvents.message,
      status: deploymentRunEvents.status,
      stepKey: deploymentRunEvents.stepKey,
    })
    .from(deploymentRunEvents)
    .where(and(isNotNull(deploymentRunEvents.status), inArray(deploymentRunEvents.deploymentRunId, deploymentRunIds)))
    .orderBy(asc(deploymentRunEvents.createdAt), asc(deploymentRunEvents.id));
}

function toDeploymentPhaseEventRow(row: DeploymentPhaseEventDatabaseRow): DeploymentPhaseEventRow {
  return {
    ...row,
    level: row.level as DeploymentRunLogLevel,
    status: row.status as DeploymentRunStepStatus,
    stepKey: row.stepKey as DeploymentRunStepKey,
  };
}
