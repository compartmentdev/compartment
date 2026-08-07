import type { WorkerFailDeploymentRequest } from '@compartment/contracts';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import { markDeploymentFailed, updateBuildArtifactImage } from '../queries/deployments.query';
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
  await persistFailedBuildArtifactImage(deployment, input.imageRef, completedAt);
  await markDeploymentFailed({
    completedAt,
    deploymentId: input.deploymentId,
    failureMessage: input.message,
    updatedAt: completedAt,
  });
  await updateOperationRecord({
    completedAt,
    operationId: deployment.operation.id,
    organizationId: deployment.project.organizationId,
    status: 'failed',
    summary: input.message,
  });
  await cleanupDeploymentSourceArchive(deployment.artifact);
}

async function persistFailedBuildArtifactImage(
  deployment: DeploymentJoinedRow,
  imageRef: string | undefined,
  updatedAt: Date,
): Promise<void> {
  if (imageRef !== undefined) {
    await updateBuildArtifactImage({ buildArtifactId: deployment.artifact.id, imageRef, updatedAt });
  }
}

export function archivedProjectDeploymentFailureMessage(deploymentId: string): string {
  return `Deployment ${deploymentId} could not be activated because the project was archived.`;
}
