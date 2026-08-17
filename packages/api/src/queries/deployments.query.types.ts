import type { QueryPromise } from 'drizzle-orm';
import type {
  AppRouteAccessMode,
  CompartmentServiceKind,
  DeploymentPromotionStage,
  DeploymentRuntimeHealth,
  DeploymentRuntimeStatus,
} from '@compartment/contracts';
import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  deploymentRoutes,
  buildArtifacts,
  deployments,
  environments,
  operations,
  projectServices,
  projects,
} from '../db/schema';
import type { OperationRecord } from './operations.query.types';
import type { PersistedProjectRow, ProjectRow } from './projects.query.types';

export type {
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
  CreateBuildArtifactInput,
  CreateDeploymentInput,
  CreateDeploymentSourceProvenanceInput,
  CreateQueuedDeploymentBatchDeploymentInput,
  CreateQueuedDeploymentBatchItem,
  CreateQueuedExistingArtifactDeploymentBatchItem,
  CreateQueuedExistingArtifactDeploymentInput,
  MarkBuildArtifactsCleanedInput,
  MarkDeploymentFailedInput,
  UpdateBuildArtifactImageInput,
} from './deployments.query.write.types';

export type DeploymentTransaction = ApiDatabaseTransaction;
export type CreateQueuedExistingArtifactDeploymentBatchResult = DeploymentRow[] | 'project-archived';
export type ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult = DeploymentRow[] | 'project-archived' | undefined;
export type PersistedDeploymentRow = typeof deployments.$inferSelect;
export type PersistedEnvironmentRow = typeof environments.$inferSelect;
export type PersistedOperationRow = typeof operations.$inferSelect;
export type PersistedProjectServiceRow = typeof projectServices.$inferSelect;
export type PersistedBuildArtifactRow = typeof buildArtifacts.$inferSelect;
export type JoinedDeploymentQuery = QueryPromise<PersistedDeploymentJoinedRow[]> & {
  limit(limit: number): QueryPromise<PersistedDeploymentJoinedRow[]>;
};
export interface JoinedDeploymentSelection extends SelectedFields {
  deployment: typeof deployments;
  environment: typeof environments;
  operation: typeof operations;
  project: typeof projects;
  artifact: typeof buildArtifacts;
  routeSubdomain: typeof deploymentRoutes.subdomain;
  service: typeof projectServices;
}

export interface PersistedDeploymentJoinedRow {
  deployment: PersistedDeploymentRow;
  environment: PersistedEnvironmentRow;
  operation: PersistedOperationRow;
  project: PersistedProjectRow;
  artifact: PersistedBuildArtifactRow;
  routeSubdomain: string | null;
  service: PersistedProjectServiceRow;
}

export interface ProjectServiceRow {
  createdAt: Date;
  id: string;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
  projectId: string;
  updatedAt: Date;
}

export interface ProjectServiceCountRow {
  projectId: string;
  serviceCount: number;
}

export interface EnvironmentRow {
  createdAt: Date;
  id: string;
  name: string;
  projectId: string;
  updatedAt: Date;
}

export interface LockedDeploymentProjectRow {
  archivedAt: Date | null;
  environmentId: string;
  projectId: string;
}

export interface PersistedStoppedDeploymentOperationRow {
  operationId: string;
}
export type BuildArtifactImageRetentionState = 'available' | 'cleaned';

export interface BuildArtifactRow {
  createdAt: Date;
  createdByPrincipalId: string | null;
  id: string;
  imageCleanedAt: Date | null;
  imageRepository: string;
  imageRef: string | null;
  imageRetentionState: BuildArtifactImageRetentionState;
  projectId: string;
  projectServiceId: string;
  resolvedBuildJson: string;
  resolvedBuildEnvJson: string;
  sourceDigest: string;
  sourceUploadId: string | null;
  updatedAt: Date;
}

export interface DeploymentRow {
  accessMode: AppRouteAccessMode;
  completedAt: Date | null;
  createdAt: Date;
  deploymentRunId: string;
  environmentId: string;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  id: string;
  isActive: boolean;
  movementSourceDeploymentId: string | null;
  label: string | null;
  operationId: string;
  projectServiceId: string;
  promotionStage: DeploymentPromotionStage;
  buildArtifactId: string;
  resolvedPortsJson: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRunJson: string;
  resolvedRoutesJson: string;
  sourceAutomationPrincipalId: string | null;
  sourceBindingId: string | null;
  sourceBindingSnapshotJson: string | null;
  sourceCommitSha: string | null;
  sourceEventId: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  sourceRepositorySnapshotJson: string | null;
  sourceResolutionTaskId: string | null;
  routeBaseDomain: string | null;
  routeHost: string | null;
  status: DeploymentRuntimeStatus;
  updatedAt: Date;
}

export interface DeploymentJoinedRow {
  deployment: DeploymentRow;
  environment: EnvironmentRow;
  operation: OperationRecord;
  project: ProjectRow;
  artifact: BuildArtifactRow;
  service: ProjectServiceRow;
}

export interface FindDeploymentRunDeploymentInput {
  deploymentId: string;
  deploymentRunId: string;
}

export interface CreateProjectServiceInput {
  id: string;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
  projectId: string;
  updatedAt: Date;
}

export interface UpdateProjectServiceInput {
  kind: CompartmentServiceKind;
  path: string;
  projectServiceId: string;
  updatedAt: Date;
}

export interface CreateEnvironmentInput {
  id: string;
  name: string;
  projectId: string;
  updatedAt: Date;
}
