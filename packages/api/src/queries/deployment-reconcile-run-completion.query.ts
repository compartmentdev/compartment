import { and, eq, inArray, ne } from 'drizzle-orm';
import { deploymentRuns, deployments, operations } from '../db/schema';
import type { DeploymentTransaction } from './deployments.query.types';

interface IncompleteDeploymentRow {
  id: string;
}

interface RunOperationRow {
  id: string;
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
  completedAt: Date,
): Promise<void> {
  if (await hasIncompleteDeployment(tx, deploymentRunId)) {
    return;
  }
  const operationIds: string[] = await listRunOperationIds(tx, deploymentRunId);
  await tx.update(operations).set({ completedAt, status: 'succeeded' }).where(inArray(operations.id, operationIds));
}

async function hasIncompleteDeployment(tx: DeploymentTransaction, deploymentRunId: string): Promise<boolean> {
  const [incompleteDeployment]: IncompleteDeploymentRow[] = await tx
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.deploymentRunId, deploymentRunId), ne(deployments.status, 'succeeded')))
    .limit(1);
  return incompleteDeployment !== undefined;
}

async function listRunOperationIds(tx: DeploymentTransaction, deploymentRunId: string): Promise<string[]> {
  const runOperations: RunOperationRow[] = await tx
    .select({ id: deployments.operationId })
    .from(deployments)
    .where(eq(deployments.deploymentRunId, deploymentRunId));
  return runOperations.map((operation: RunOperationRow): string => operation.id);
}
