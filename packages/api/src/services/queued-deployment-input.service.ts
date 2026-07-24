import type { AppRouteAccessMode } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import type { CreateQueuedDeploymentBatchDeploymentInput } from '../queries/deployments.query.types';
import type { DeploymentSourceProvenance } from './deployments.service.types';

interface BuildQueuedDeploymentBaseInput extends Partial<DeploymentSourceProvenance> {
  accessMode: AppRouteAccessMode;
  deploymentRunId: string;
  environmentId: string;
  label?: string | null | undefined;
  movementSourceDeploymentId?: string | null | undefined;
  projectServiceId: string;
  resolvedPortsJson: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRoutesJson: string;
  resolvedRunJson: string;
}

export function buildQueuedDeploymentBaseInput(
  input: BuildQueuedDeploymentBaseInput,
): CreateQueuedDeploymentBatchDeploymentInput {
  return {
    accessMode: input.accessMode,
    deploymentRunId: input.deploymentRunId,
    environmentId: input.environmentId,
    health: 'pending',
    id: createId('dep'),
    ...buildQueuedDeploymentOptionalFields(input),
    projectServiceId: input.projectServiceId,
    promotionStage: 'building',
    resolvedPortsJson: input.resolvedPortsJson,
    resolvedReadinessJson: input.resolvedReadinessJson,
    resolvedReleaseJson: input.resolvedReleaseJson,
    resolvedRoutesJson: input.resolvedRoutesJson,
    resolvedRunJson: input.resolvedRunJson,
    ...readSourceProvenanceFields(input),
    status: 'queued',
    updatedAt: new Date(),
  };
}

function buildQueuedDeploymentOptionalFields(
  input: BuildQueuedDeploymentBaseInput,
): Pick<CreateQueuedDeploymentBatchDeploymentInput, 'label' | 'movementSourceDeploymentId'> {
  return {
    ...(input.label !== undefined ? { label: input.label } : {}),
    movementSourceDeploymentId: input.movementSourceDeploymentId,
  };
}

function readSourceProvenanceFields(input: BuildQueuedDeploymentBaseInput): Partial<DeploymentSourceProvenance> {
  return input.sourceAutomationPrincipalId === undefined ? {} : buildSourceProvenanceFields(input);
}

function buildSourceProvenanceFields(input: BuildQueuedDeploymentBaseInput): DeploymentSourceProvenance {
  return {
    sourceAutomationPrincipalId: requireSourceProvenanceField(
      input.sourceAutomationPrincipalId,
      'sourceAutomationPrincipalId',
    ),
    sourceBindingId: requireSourceProvenanceField(input.sourceBindingId, 'sourceBindingId'),
    sourceBindingSnapshotJson: requireSourceProvenanceField(
      input.sourceBindingSnapshotJson,
      'sourceBindingSnapshotJson',
    ),
    sourceCommitSha: requireSourceProvenanceField(input.sourceCommitSha, 'sourceCommitSha'),
    sourceEventId: requireSourceProvenanceField(input.sourceEventId, 'sourceEventId'),
    sourceId: requireSourceProvenanceField(input.sourceId, 'sourceId'),
    sourceKind: requireSourceProvenanceField(input.sourceKind, 'sourceKind'),
    sourceRepositorySnapshotJson: requireSourceProvenanceField(
      input.sourceRepositorySnapshotJson,
      'sourceRepositorySnapshotJson',
    ),
    sourceResolutionTaskId: requireSourceProvenanceField(input.sourceResolutionTaskId, 'sourceResolutionTaskId'),
  };
}

function requireSourceProvenanceField(value: string | undefined, fieldName: keyof DeploymentSourceProvenance): string {
  if (value === undefined) {
    throw new Error(`Missing ${fieldName} for source deployment provenance.`);
  }

  return value;
}
