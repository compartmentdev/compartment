import type {
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentJoinedRow,
  DeploymentRow,
  EnvironmentRow,
} from '../queries/deployments.query.types';
import { createQueuedExistingArtifactDeploymentBatch } from '../queries/deployments.query';
import { buildArtifactDeploymentBatchItem } from './artifact-deployment-batch-item.service';
import { requireQueuedExistingArtifactDeployments } from './artifact-deployment-queue-result.service';
import {
  appendQueuedDeploymentRunEvents,
  createDeploymentRunId,
  withDeploymentRunCleanupOnError,
} from './deployment-run-creation.service';
import { readDeploymentRunSourceProvenanceInput } from './deployment-run-source.service';
import { hydrateJoinedDeploymentsById } from './joined-deployment-hydration.service';

export async function queueArtifactStartDeployments(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
): Promise<DeploymentJoinedRow[]> {
  const deploymentRunId: string = await createStartDeploymentRunId(sourceDeployments[0], targetEnvironment);
  const queuedDeployments: DeploymentRow[] = await withDeploymentRunCleanupOnError(
    deploymentRunId,
    async (): Promise<DeploymentRow[]> => {
      return requireQueuedExistingArtifactDeployments(
        await createQueuedExistingArtifactDeploymentBatch({
          items: buildArtifactStartDeploymentBatchItems(
            sourceDeployments,
            targetEnvironment,
            actorPrincipalId,
            deploymentRunId,
          ),
          projectId: targetEnvironment.projectId,
        }),
      );
    },
  );

  await appendQueuedDeploymentRunEvents(queuedDeployments);
  return await hydrateJoinedDeploymentsById(queuedDeployments);
}

function buildArtifactStartDeploymentBatchItems(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  deploymentRunId: string,
): CreateQueuedExistingArtifactDeploymentBatchItem[] {
  return sourceDeployments.map(
    (sourceDeployment: DeploymentJoinedRow): CreateQueuedExistingArtifactDeploymentBatchItem =>
      buildArtifactDeploymentBatchItem(
        sourceDeployment,
        targetEnvironment,
        actorPrincipalId,
        deploymentRunId,
        'deployment.start',
      ),
  );
}

async function createStartDeploymentRunId(
  sourceDeployment: DeploymentJoinedRow | undefined,
  targetEnvironment: EnvironmentRow,
): Promise<string> {
  return await createDeploymentRunId({
    environmentId: targetEnvironment.id,
    label: sourceDeployment?.deployment.label ?? null,
    sourceProvenance:
      sourceDeployment !== undefined ? readDeploymentRunSourceProvenanceInput(sourceDeployment) : undefined,
    triggerType: 'start',
    updatedAt: new Date(),
  });
}
