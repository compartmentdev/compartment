import type { WorkerFailDeploymentRequest } from '@compartment/contracts';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { failOwnedBuildArtifact, markDeploymentFailed } from '../queries/deployments.query';
import { updateOperationRecord } from '../queries/operations.query';
import { getApiConfig } from '../runtime/runtime-access';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { requireJoinedDeployment } from './deployment-context.service';
import { cleanupDeploymentSourceArchive } from './source-archive-cleanup.service';

export async function finalizeFailedDeployment(input: WorkerFailDeploymentRequest): Promise<void> {
  const deployment: DeploymentJoinedRow = requireJoinedDeployment(
    await findJoinedDeploymentById(input.deploymentId, getApiConfig().baseDomain),
  );
  const completedAt: Date = new Date();
  const artifactId: string = deployment.artifact.id;
  const shouldCleanupSourceArchive: boolean = await failOwnedBuildArtifact(
    artifactId,
    input.deploymentId,
    input.imageRef,
  );
  await markDeploymentFailed({
    completedAt,
    deploymentId: input.deploymentId,
    failureMessage: input.message,
    updatedAt: completedAt,
  });
  await updateOperationRecord({
    completedAt,
    operationId: deployment.operation.id,
    status: 'failed',
    summary: input.message,
  });
  await cleanupFailedArtifactSourceArchive(deployment, shouldCleanupSourceArchive);
}

async function cleanupFailedArtifactSourceArchive(
  deployment: DeploymentJoinedRow,
  shouldCleanup: boolean,
): Promise<void> {
  if (shouldCleanup) {
    await cleanupDeploymentSourceArchive(deployment.artifact);
  }
}

export function archivedProjectDeploymentFailureMessage(deploymentId: string): string {
  return `Deployment ${deploymentId} could not be activated because the project was archived.`;
}
