import type {
  CreateQueuedExistingArtifactDeploymentBatchResult,
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentJoinedRow,
  DeploymentRow,
  EnvironmentRow,
} from '../queries/deployments.query.types';
import { createQueuedExistingArtifactDeploymentBatch } from '../queries/deployments.query';
import { createProjectArchivedError } from '../errors/api-business-error';
import { buildArtifactDeploymentBatchItem } from './artifact-deployment-batch-item.service';
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
      const items: CreateQueuedExistingArtifactDeploymentBatchItem[] = sourceDeployments.map(
        (sourceDeployment: DeploymentJoinedRow): CreateQueuedExistingArtifactDeploymentBatchItem =>
          buildArtifactDeploymentBatchItem(
            sourceDeployment,
            targetEnvironment,
            actorPrincipalId,
            deploymentRunId,
            'deployment.start',
          ),
      );
      const result: CreateQueuedExistingArtifactDeploymentBatchResult =
        await createQueuedExistingArtifactDeploymentBatch(items);
      if (result === 'project-archived') {
        throw createProjectArchivedError();
      }
      return result;
    },
  );

  await appendQueuedDeploymentRunEvents(queuedDeployments);
  return await hydrateJoinedDeploymentsById(queuedDeployments);
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
