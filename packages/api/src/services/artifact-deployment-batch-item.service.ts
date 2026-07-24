import type {
  CreateQueuedExistingArtifactDeploymentBatchItem,
  CreateQueuedExistingArtifactDeploymentInput,
  DeploymentJoinedRow,
  EnvironmentRow,
} from '../queries/deployments.query.types';
import type { InsertOperationInput } from '../queries/operations.query.types';
import type { DeploymentMovementOperationType } from './deployment-movement.service.types';
import { buildDeploymentTargetLabel } from './deployment-target-label.service';
import { serializeResolvedRelease } from './deployment-release.service';
import { buildQueuedDeploymentBaseInput } from './queued-deployment-input.service';

type ArtifactDeploymentBatchOperationType = DeploymentMovementOperationType | 'deployment.start';

export function buildArtifactDeploymentBatchItem(
  sourceDeployment: DeploymentJoinedRow,
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  deploymentRunId: string,
  operationType: ArtifactDeploymentBatchOperationType,
): CreateQueuedExistingArtifactDeploymentBatchItem {
  return {
    deployment: buildArtifactDeploymentInput(sourceDeployment, targetEnvironment, deploymentRunId, operationType),
    operation: buildArtifactDeploymentOperationInput(
      sourceDeployment,
      targetEnvironment,
      actorPrincipalId,
      operationType,
    ),
  };
}

function buildArtifactDeploymentInput(
  sourceDeployment: DeploymentJoinedRow,
  targetEnvironment: EnvironmentRow,
  deploymentRunId: string,
  operationType: ArtifactDeploymentBatchOperationType,
): CreateQueuedExistingArtifactDeploymentInput {
  return {
    ...buildQueuedDeploymentBaseInput({
      accessMode: sourceDeployment.deployment.accessMode,
      deploymentRunId,
      environmentId: targetEnvironment.id,
      label: sourceDeployment.deployment.label,
      movementSourceDeploymentId: operationType === 'deployment.start' ? null : sourceDeployment.deployment.id,
      projectServiceId: sourceDeployment.service.id,
      resolvedPortsJson: sourceDeployment.deployment.resolvedPortsJson,
      resolvedReadinessJson: sourceDeployment.deployment.resolvedReadinessJson,
      resolvedReleaseJson: serializeResolvedRelease(null),
      resolvedRoutesJson: sourceDeployment.deployment.resolvedRoutesJson,
      resolvedRunJson: sourceDeployment.deployment.resolvedRunJson,
    }),
    buildArtifactId: sourceDeployment.artifact.id,
  };
}

function buildArtifactDeploymentOperationInput(
  sourceDeployment: DeploymentJoinedRow,
  targetEnvironment: EnvironmentRow,
  actorPrincipalId: string,
  operationType: ArtifactDeploymentBatchOperationType,
): InsertOperationInput {
  return {
    actorPrincipalId,
    status: 'queued',
    summary: buildArtifactDeploymentOperationSummary(sourceDeployment, targetEnvironment, operationType),
    targetId: targetEnvironment.id,
    targetType: 'environment',
    type: operationType,
  };
}

function buildArtifactDeploymentOperationSummary(
  sourceDeployment: DeploymentJoinedRow,
  targetEnvironment: EnvironmentRow,
  operationType: ArtifactDeploymentBatchOperationType,
): string {
  const deploymentTarget: string = buildDeploymentTargetLabel(
    sourceDeployment.project.name,
    targetEnvironment.name,
    sourceDeployment.service.name,
  );

  switch (operationType) {
    case 'deployment.promote':
      return `Queued promotion for ${deploymentTarget} from deployment ${sourceDeployment.deployment.id}`;
    case 'deployment.rollback':
      return `Queued rollback for ${deploymentTarget} to deployment ${sourceDeployment.deployment.id}`;
    case 'deployment.start':
      return `Queued start for ${deploymentTarget} from deployment ${sourceDeployment.deployment.id}`;
  }
}
