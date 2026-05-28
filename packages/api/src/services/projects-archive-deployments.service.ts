import { createId } from '../lib/tokens';
import { appendDeploymentRunEventWithExecutor } from '../queries/deployment-run-events.query';
import { markQueuedProjectDeploymentsFailedWithExecutor } from '../queries/deployment-archive.query';
import { findBuildArtifactById } from '../queries/deployments.query';
import type { BuildArtifactRow, DeploymentRow } from '../queries/deployments.query.types';
import { updateOperationRecordWithExecutor } from '../queries/operations.query';
import type { ProjectsMutationTransaction } from '../queries/projects.query.types';
import { cleanupConsumedSourceUpload } from './source-uploads.service';

const archivedQueuedDeploymentFailureMessage: string =
  'Deployment canceled because the project was archived before the worker claimed it.';

export async function cancelQueuedProjectDeploymentsForArchive(
  transaction: ProjectsMutationTransaction,
  projectId: string,
): Promise<DeploymentRow[]> {
  const now: Date = new Date();
  const deployments: DeploymentRow[] = await markQueuedProjectDeploymentsFailedWithExecutor(transaction, {
    completedAt: now,
    failureMessage: archivedQueuedDeploymentFailureMessage,
    projectId,
    updatedAt: now,
  });

  for (const deployment of deployments) {
    await finalizeCanceledQueuedDeployment(transaction, deployment, now);
  }

  return deployments;
}

export async function cleanupCanceledDeploymentSourceUploads(deployments: DeploymentRow[]): Promise<void> {
  const sourceUploadIds: Set<string> = new Set<string>();
  for (const deployment of deployments) {
    const artifact: BuildArtifactRow | undefined = await findBuildArtifactById(deployment.buildArtifactId);
    if (artifact !== undefined && artifact.sourceUploadId !== null) {
      sourceUploadIds.add(artifact.sourceUploadId);
    }
  }

  for (const sourceUploadId of sourceUploadIds) {
    await cleanupConsumedSourceUpload(sourceUploadId);
  }
}

async function finalizeCanceledQueuedDeployment(
  transaction: ProjectsMutationTransaction,
  deployment: DeploymentRow,
  completedAt: Date,
): Promise<void> {
  await updateOperationRecordWithExecutor(transaction, {
    completedAt,
    operationId: deployment.operationId,
    status: 'failed',
    summary: archivedQueuedDeploymentFailureMessage,
  });
  await appendDeploymentRunEventWithExecutor(transaction, {
    createdAt: completedAt,
    deploymentId: deployment.id,
    deploymentRunId: deployment.deploymentRunId,
    id: createId('drev'),
    level: 'error',
    message: archivedQueuedDeploymentFailureMessage,
    status: 'failed',
    stepKey: 'completed',
    stream: 'compartment',
  });
}
