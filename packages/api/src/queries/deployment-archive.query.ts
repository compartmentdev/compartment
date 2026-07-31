import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client';
import { deployments, environments } from '../db/schema';
import { toDeploymentRow } from './deployment-row.mapper';
import type {
  DeploymentRow,
  DeploymentTransaction,
  MarkQueuedProjectDeploymentsFailedInput,
  PersistedDeploymentRow,
} from './deployments.query.types';

interface FailedQueuedDeploymentValues {
  completedAt: Date;
  drainDeadlineAt: null;
  drainingContainerId: null;
  drainingDeploymentId: null;
  drainingNodeId: null;
  failureMessage: string;
  health: 'unhealthy';
  isActive: false;
  promotionStage: 'rolled_back';
  status: 'failed';
  updatedAt: Date;
}

interface QueuedProjectDeploymentIdRow {
  id: string;
}

export async function markQueuedProjectDeploymentsFailedWithExecutor(
  executor: DeploymentTransaction,
  input: MarkQueuedProjectDeploymentsFailedInput,
): Promise<DeploymentRow[]> {
  const deploymentIds: string[] = await listQueuedProjectDeploymentIdsWithExecutor(executor, input.projectId);
  if (deploymentIds.length === 0) {
    return [];
  }

  return await updateQueuedDeploymentsFailedWithExecutor(executor, deploymentIds, input);
}

async function updateQueuedDeploymentsFailedWithExecutor(
  executor: DeploymentTransaction,
  deploymentIds: string[],
  input: MarkQueuedProjectDeploymentsFailedInput,
): Promise<DeploymentRow[]> {
  const rows: PersistedDeploymentRow[] = await executor
    .update(deployments)
    .set(buildFailedQueuedDeploymentValues(input))
    .where(and(inArray(deployments.id, deploymentIds), eq(deployments.status, 'queued')))
    .returning();

  return rows.map(toDeploymentRow);
}

async function listQueuedProjectDeploymentIdsWithExecutor(
  executor: Pick<Database, 'select'>,
  projectId: string,
): Promise<string[]> {
  const rows: QueuedProjectDeploymentIdRow[] = await executor
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .where(and(eq(environments.projectId, projectId), eq(deployments.status, 'queued')));

  return rows.map((row: QueuedProjectDeploymentIdRow): string => row.id);
}

function buildFailedQueuedDeploymentValues(
  input: MarkQueuedProjectDeploymentsFailedInput,
): FailedQueuedDeploymentValues {
  return {
    completedAt: input.completedAt,
    drainDeadlineAt: null,
    drainingContainerId: null,
    drainingDeploymentId: null,
    drainingNodeId: null,
    failureMessage: input.failureMessage,
    health: 'unhealthy',
    isActive: false,
    promotionStage: 'rolled_back',
    status: 'failed',
    updatedAt: input.updatedAt,
  };
}
