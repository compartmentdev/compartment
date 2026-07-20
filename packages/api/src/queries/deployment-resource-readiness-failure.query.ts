import { and, eq, inArray, sql } from 'drizzle-orm';
import { deploymentKubeReferences, deploymentRunEvents, deployments, operations, projectResources } from '../db/schema';
import { createId } from '../lib/tokens';
import type { DeploymentTransaction } from './deployments.query.types';

interface WaitingResourceDeploymentRow {
  deploymentId: string;
  deploymentRunId: string;
}

export async function failDesiredDeploymentsWaitingForResource(
  tx: DeploymentTransaction,
  resourceId: string,
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  const waiting: WaitingResourceDeploymentRow[] = await findWaitingDeployments(tx, resourceId);
  const deploymentIds: string[] = waiting.map((row: WaitingResourceDeploymentRow): string => row.deploymentId);
  if (deploymentIds.length === 0) {
    return;
  }
  await failDeployments(tx, deploymentIds, failureMessage, failedAt);
  await failOperations(tx, deploymentIds, failureMessage, failedAt);
  await failReferences(tx, deploymentIds, failedAt);
  await publishFailureEvents(tx, waiting, failureMessage, failedAt);
}

async function publishFailureEvents(
  tx: DeploymentTransaction,
  waiting: WaitingResourceDeploymentRow[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  await tx.insert(deploymentRunEvents).values(
    waiting.map((row: WaitingResourceDeploymentRow): typeof deploymentRunEvents.$inferInsert => ({
      createdAt: failedAt,
      deploymentId: row.deploymentId,
      deploymentRunId: row.deploymentRunId,
      id: createId('drev'),
      level: 'error',
      message: failureMessage,
      status: 'failed',
      stepKey: 'provisioning',
      stream: 'compartment',
    })),
  );
}

async function findWaitingDeployments(
  tx: DeploymentTransaction,
  resourceId: string,
): Promise<WaitingResourceDeploymentRow[]> {
  return await tx
    .select({ deploymentId: deployments.id, deploymentRunId: deployments.deploymentRunId })
    .from(deployments)
    .innerJoin(deploymentKubeReferences, eq(deploymentKubeReferences.deploymentId, deployments.id))
    .innerJoin(projectResources, eq(projectResources.environmentId, deployments.environmentId))
    .where(
      and(
        eq(projectResources.id, resourceId),
        eq(deployments.status, 'running'),
        eq(deploymentKubeReferences.state, 'desired'),
      ),
    )
    .for('update', { of: deploymentKubeReferences });
}

async function failDeployments(
  tx: DeploymentTransaction,
  deploymentIds: string[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  await tx
    .update(deployments)
    .set({ completedAt: failedAt, failureMessage, health: 'unhealthy', status: 'failed', updatedAt: failedAt })
    .where(inArray(deployments.id, deploymentIds));
}

async function failOperations(
  tx: DeploymentTransaction,
  deploymentIds: string[],
  failureMessage: string,
  failedAt: Date,
): Promise<void> {
  await tx
    .update(operations)
    .set({ completedAt: failedAt, status: 'failed', summary: failureMessage })
    .where(inArray(operations.targetId, deploymentIds));
}

async function failReferences(tx: DeploymentTransaction, deploymentIds: string[], failedAt: Date): Promise<void> {
  await tx
    .update(deploymentKubeReferences)
    .set({
      observedAt: failedAt,
      revision: sql`${deploymentKubeReferences.revision} + 1`,
      state: 'pending',
      transitionedAt: failedAt,
      updatedAt: failedAt,
    })
    .where(inArray(deploymentKubeReferences.deploymentId, deploymentIds));
}
