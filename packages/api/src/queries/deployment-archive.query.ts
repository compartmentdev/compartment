import { and, eq, inArray, lte, notExists, sql } from 'drizzle-orm';
import { deploymentKubeReferences, deployments, environments, operations } from '../db/schema';
import type { DeploymentTransaction, PersistedStoppedDeploymentOperationRow } from './deployments.query.types';

export async function stopInactiveQueuedProjectDeploymentsForArchivedProject(
  transaction: DeploymentTransaction,
  projectId: string,
  stoppedAt: Date,
): Promise<void> {
  const stoppedDeployments: PersistedStoppedDeploymentOperationRow[] = await transaction
    .update(deployments)
    .set({
      completedAt: stoppedAt,
      health: 'healthy',
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
      updatedAt: stoppedAt,
    })
    .where(
      and(
        eq(deployments.status, 'queued'),
        eq(deployments.isActive, false),
        sql`exists (
          select 1
          from ${environments}
          where ${environments.id} = ${deployments.environmentId}
            and ${environments.projectId} = ${projectId}
        )`,
      ),
    )
    .returning({ operationId: deployments.operationId });
  await terminalizeArchivedDeploymentOperations(transaction, stoppedDeployments, stoppedAt);
}

export async function stopInactiveDeploymentBuildsForArchivedProjects(
  transaction: DeploymentTransaction,
  deploymentIds: string[],
  stoppedAt: Date,
  staleBefore: Date,
): Promise<void> {
  if (deploymentIds.length === 0) {
    return;
  }
  const stoppedDeployments: PersistedStoppedDeploymentOperationRow[] = await transaction
    .update(deployments)
    .set({
      completedAt: stoppedAt,
      health: 'healthy',
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
      updatedAt: stoppedAt,
    })
    .where(
      and(
        inArray(deployments.id, deploymentIds),
        eq(deployments.status, 'running'),
        eq(deployments.isActive, false),
        lte(deployments.updatedAt, staleBefore),
        notExists(
          transaction
            .select({ deploymentId: deploymentKubeReferences.deploymentId })
            .from(deploymentKubeReferences)
            .where(eq(deploymentKubeReferences.deploymentId, deployments.id)),
        ),
      ),
    )
    .returning({ operationId: deployments.operationId });
  await terminalizeArchivedDeploymentOperations(transaction, stoppedDeployments, stoppedAt);
}

async function terminalizeArchivedDeploymentOperations(
  transaction: DeploymentTransaction,
  stoppedDeployments: PersistedStoppedDeploymentOperationRow[],
  stoppedAt: Date,
): Promise<void> {
  if (stoppedDeployments.length === 0) {
    return;
  }
  await transaction
    .update(operations)
    .set({
      completedAt: stoppedAt,
      status: 'failed',
      summary: 'Deployment was stopped because the project was archived.',
    })
    .where(
      inArray(
        operations.id,
        stoppedDeployments.map((deployment: PersistedStoppedDeploymentOperationRow): string => deployment.operationId),
      ),
    );
}
