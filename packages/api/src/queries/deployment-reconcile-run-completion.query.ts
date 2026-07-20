import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { deploymentRuns, deployments, operations } from '../db/schema';
import type { DeploymentTransaction } from './deployments.query.types';

interface IncompleteDeploymentRow {
  id: string;
}

interface RunOperationRow {
  deploymentId: string;
  operationId: string;
}

export async function lockDeploymentRun(tx: DeploymentTransaction, deploymentRunId: string): Promise<void> {
  await tx
    .select({ id: deploymentRuns.id })
    .from(deploymentRuns)
    .where(eq(deploymentRuns.id, deploymentRunId))
    .for('update');
}

export async function markReadyRunOperationsSucceeded(
  tx: DeploymentTransaction,
  deploymentRunId: string,
): Promise<void> {
  if (await hasIncompleteDeployment(tx, deploymentRunId)) {
    return;
  }
  const runOperations: RunOperationRow[] = await listRunOperations(tx, deploymentRunId);
  const completedAt: Date = await findRunCompletedAt(tx, deploymentRunId);
  for (const operation of runOperations) {
    await tx
      .update(operations)
      .set({
        completedAt,
        status: 'succeeded',
        summary: `Deployment ${operation.deploymentId} is active in Kubernetes`,
      })
      .where(eq(operations.id, operation.operationId));
  }
}

export async function markRunOperationsFailed(
  tx: DeploymentTransaction,
  deploymentRunId: string,
  completedAt: Date,
  summary: string,
): Promise<void> {
  const operationIds: string[] = (await listRunOperations(tx, deploymentRunId)).map(
    (operation: RunOperationRow): string => operation.operationId,
  );
  await tx
    .update(operations)
    .set({ completedAt, status: 'failed', summary })
    .where(inArray(operations.id, operationIds));
}

async function findRunCompletedAt(tx: DeploymentTransaction, deploymentRunId: string): Promise<Date> {
  const [latestDeployment]: { completedAt: Date | null }[] = await tx
    .select({ completedAt: deployments.completedAt })
    .from(deployments)
    .where(eq(deployments.deploymentRunId, deploymentRunId))
    .orderBy(desc(deployments.completedAt))
    .limit(1);
  if (latestDeployment?.completedAt === null || latestDeployment === undefined) {
    throw new Error('Completed deployment run is missing a completion timestamp.');
  }
  return latestDeployment.completedAt;
}

async function hasIncompleteDeployment(tx: DeploymentTransaction, deploymentRunId: string): Promise<boolean> {
  const [incompleteDeployment]: IncompleteDeploymentRow[] = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.deploymentRunId, deploymentRunId), ne(deployments.status, 'succeeded')))
    .limit(1);
  return incompleteDeployment !== undefined;
}

async function listRunOperations(tx: DeploymentTransaction, deploymentRunId: string): Promise<RunOperationRow[]> {
  const runOperations: RunOperationRow[] = await tx
    .select({ deploymentId: deployments.id, operationId: deployments.operationId })
    .from(deployments)
    .where(eq(deployments.deploymentRunId, deploymentRunId));
  return runOperations;
}
