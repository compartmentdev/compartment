import type {
  CreateDeploymentSourceProvenanceInput,
  DeploymentJoinedRow,
  DeploymentRow,
} from '../queries/deployments.query.types';

export function readDeploymentRunSourceProvenanceInput(
  deployment: DeploymentJoinedRow,
): CreateDeploymentSourceProvenanceInput {
  const sourceDeployment: DeploymentRow = deployment.deployment;
  const provenance: CreateDeploymentSourceProvenanceInput = {};

  appendNullableSourceField(provenance, 'sourceAutomationPrincipalId', sourceDeployment.sourceAutomationPrincipalId);
  appendNullableSourceField(provenance, 'sourceBindingId', sourceDeployment.sourceBindingId);
  appendNullableSourceField(provenance, 'sourceBindingSnapshotJson', sourceDeployment.sourceBindingSnapshotJson);
  appendNullableSourceField(provenance, 'sourceCommitSha', sourceDeployment.sourceCommitSha);
  appendNullableSourceField(provenance, 'sourceEventId', sourceDeployment.sourceEventId);
  appendNullableSourceField(provenance, 'sourceId', sourceDeployment.sourceId);
  appendNullableSourceField(provenance, 'sourceKind', sourceDeployment.sourceKind);
  appendNullableSourceField(provenance, 'sourceRepositorySnapshotJson', sourceDeployment.sourceRepositorySnapshotJson);
  appendNullableSourceField(provenance, 'sourceResolutionTaskId', sourceDeployment.sourceResolutionTaskId);

  return provenance;
}

function appendNullableSourceField(
  target: CreateDeploymentSourceProvenanceInput,
  field: keyof CreateDeploymentSourceProvenanceInput,
  value: string | null,
): void {
  if (value !== null) {
    target[field] = value;
  }
}
