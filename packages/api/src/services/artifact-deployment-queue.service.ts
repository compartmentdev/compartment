import type {
  CreateQueuedExistingArtifactDeploymentBatchItem,
  DeploymentJoinedRow,
  EnvironmentRow,
} from '../queries/deployments.query.types';
import { createQueuedExistingArtifactDeploymentBatch } from '../queries/deployments.query';
import type { QueuedExistingArtifactDeploymentBatchResult } from '../queries/deployment-batch.query.types';
import type { DeploymentProjectMutationRejection } from '../queries/deployment-project-mutation.query.types';
import { buildArtifactDeploymentBatchItem } from './artifact-deployment-batch-item.service';
import {
  appendQueuedDeploymentRunEvents,
  createDeploymentRunId,
  withDeploymentRunCleanupOnErrorOrResult,
} from './deployment-run-creation.service';
import { readDeploymentRunSourceProvenanceInput } from './deployment-run-source.service';
import { isDeploymentProjectMutationRejection } from './deployment-project-mutation-result.service';
import { hydrateJoinedDeploymentsById } from './joined-deployment-hydration.service';

export async function queueArtifactStartDeployments(
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
): Promise<DeploymentJoinedRow[] | DeploymentProjectMutationRejection> {
  const deploymentRunId: string = await createStartDeploymentRunId(sourceDeployments[0], targetEnvironment);
  const queuedDeployments: QueuedExistingArtifactDeploymentBatchResult = await queueArtifactStartDeploymentRows(
    deploymentRunId,
    sourceDeployments,
    targetEnvironment,
    actorPrincipalId,
  );
  if (isDeploymentProjectMutationRejection(queuedDeployments)) {
    return queuedDeployments;
  }

  await appendQueuedDeploymentRunEvents(queuedDeployments);
  return await hydrateJoinedDeploymentsById(queuedDeployments);
}

async function queueArtifactStartDeploymentRows(
  deploymentRunId: string,
  sourceDeployments: DeploymentJoinedRow[],
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
): Promise<QueuedExistingArtifactDeploymentBatchResult> {
  const queuedDeployments: QueuedExistingArtifactDeploymentBatchResult = await withDeploymentRunCleanupOnErrorOrResult(
    deploymentRunId,
    async (): Promise<QueuedExistingArtifactDeploymentBatchResult> =>
      await createQueuedExistingArtifactDeploymentBatch({
        items: buildArtifactStartDeploymentBatchItems(
          sourceDeployments,
          targetEnvironment,
          actorPrincipalId,
          deploymentRunId,
        ),
        projectId: targetEnvironment.projectId,
      }),
    isDeploymentProjectMutationRejection,
  );

  return queuedDeployments;
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
