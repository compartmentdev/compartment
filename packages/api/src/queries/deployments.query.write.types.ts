import type {
  AppRouteAccessMode,
  DeploymentPromotionStage,
  DeploymentRuntimeHealth,
  DeploymentRuntimeStatus,
} from '@compartment/contracts';
import type { InsertOperationInput } from './operations.query.types';

export interface CreateDeploymentSourceProvenanceInput {
  sourceAutomationPrincipalId?: string | null | undefined;
  sourceBindingId?: string | null | undefined;
  sourceBindingSnapshotJson?: string | null | undefined;
  sourceCommitSha?: string | null | undefined;
  sourceEventId?: string | null | undefined;
  sourceId?: string | null | undefined;
  sourceKind?: string | null | undefined;
  sourceRepositorySnapshotJson?: string | null | undefined;
  sourceResolutionTaskId?: string | null | undefined;
}

export interface CreateBuildArtifactInput {
  createdByPrincipalId?: string | undefined;
  id: string;
  imageRepository: string;
  imageRef?: string | null | undefined;
  projectId: string;
  projectServiceId: string;
  resolvedBuildEnvJson: string;
  resolvedBuildJson: string;
  sourceDigest: string;
  sourceUploadId?: string | null | undefined;
  updatedAt: Date;
}

export interface UpdateBuildArtifactImageInput {
  buildArtifactId: string;
  imageRef: string;
  updatedAt: Date;
}

export interface MarkBuildArtifactsCleanedInput {
  artifactIds: string[];
  cleanedAt: Date;
  updatedAt: Date;
}

export interface CreateDeploymentInput extends CreateDeploymentSourceProvenanceInput {
  accessMode: AppRouteAccessMode;
  buildArtifactId: string;
  deploymentRunId: string;
  environmentId: string;
  health: DeploymentRuntimeHealth;
  id: string;
  label?: string | null | undefined;
  movementSourceDeploymentId?: string | null | undefined;
  operationId: string;
  promotionStage: DeploymentPromotionStage;
  projectServiceId: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRoutesJson: string;
  resolvedRunJson: string;
  status: DeploymentRuntimeStatus;
  updatedAt: Date;
}

export type CreateQueuedDeploymentBatchDeploymentInput = Omit<CreateDeploymentInput, 'operationId' | 'buildArtifactId'>;
export type CreateQueuedExistingArtifactDeploymentInput = Omit<CreateDeploymentInput, 'operationId'>;

export interface CreateQueuedDeploymentBatchItem {
  artifact: CreateBuildArtifactInput;
  deployment: CreateQueuedDeploymentBatchDeploymentInput;
  operation: InsertOperationInput;
}

export interface ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput {
  actorPrincipalId: string;
  consumedAt: Date;
  environmentId: string;
  expiresAtCutoff: Date;
  items: CreateQueuedDeploymentBatchItem[];
  organizationId: string;
  projectId: string;
  projectServiceIds: string[];
  sourceUploadId: string;
}

export interface CreateQueuedExistingArtifactDeploymentBatchItem {
  deployment: CreateQueuedExistingArtifactDeploymentInput;
  operation: InsertOperationInput;
}

export interface MarkDeploymentFailedInput {
  completedAt: Date;
  deploymentId: string;
  failureMessage: string;
  updatedAt: Date;
}
