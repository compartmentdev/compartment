import type {
  AppRouteAccessMode,
  CompartmentServiceKind,
  DeploymentPromotionStage,
  DeploymentLogStream,
  DeploymentRuntimeHealth,
  DeploymentRuntimeStatus,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  DeploymentRunTriggerType,
  OperationStatus,
  ResolvedCompartmentServiceRunConfig,
  ResourceRuntimeStatus,
} from '@compartment/contracts';
import type { BuildEnvMap } from './deployment-build.types';

export interface DeployResponseInput {
  deployments: DeploymentSummaryInput[];
  resources: DeploymentResourceSummaryInput[];
}

export interface DeploymentArtifactSummaryInput {
  id: string;
  imageRef: string | null;
  imageRetentionState: 'available' | 'cleaned';
  resolvedBuildJson: string;
  sourceDigest: string;
}

export interface DeploymentRecordSummaryInput
  extends DeploymentRecordRuntimeSummaryInput, DeploymentRecordRouteSummaryInput, DeploymentRecordSourceSummaryInput {
  buildArtifactId: string;
  createdAt: Date;
  deploymentRunId: string;
  environmentId: string;
  id: string;
  label: string | null;
  operationId: string;
  projectServiceId: string;
  updatedAt: Date;
}

interface DeploymentRecordRuntimeSummaryInput {
  completedAt: Date | null;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  isActive: boolean;
  movementSourceDeploymentId: string | null;
  promotionStage: DeploymentPromotionStage;
  status: DeploymentRuntimeStatus;
}

interface DeploymentRecordRouteSummaryInput {
  accessMode: AppRouteAccessMode;
  resolvedPortsJson: string;
  resolvedReadinessJson: string;
  resolvedReleaseJson: string;
  resolvedRoutesJson: string;
  resolvedRunJson: string;
  routeBaseDomain: string | null;
  routeHost: string | null;
}

interface DeploymentRecordSourceSummaryInput {
  sourceAutomationPrincipalId: string | null;
  sourceBindingId: string | null;
  sourceBindingSnapshotJson: string | null;
  sourceCommitSha: string | null;
  sourceEventId: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  sourceRepositorySnapshotJson: string | null;
  sourceResolutionTaskId: string | null;
}

export interface DeploymentServiceSummaryInput {
  id: string;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
}

export interface DeploymentSummaryInput {
  artifact: DeploymentArtifactSummaryInput;
  deployment: DeploymentRecordSummaryInput;
  environment: EnvironmentSummaryInput;
  operation: OperationSummaryInput;
  project: ProjectSummaryInput;
  service: DeploymentServiceSummaryInput;
}

export interface DeploymentInspectTargetInput extends DeploymentSummaryInput {
  runtime: DeploymentInspectRuntimeInput | null;
}

export interface DeploymentInspectRuntimeInput {
  imageRef: string;
  routeHost: string | null;
  serviceHost: string;
  servicePort: number;
}

export interface DeploymentResourceSummaryInput
  extends DeploymentResourceDefinitionSummaryInput, DeploymentResourceRuntimeSummaryInput {
  createdAt: Date;
  environmentId: string;
  expectedClaimsJson: string;
  id: string;
  name: string;
  updatedAt: Date;
}

interface DeploymentResourceDefinitionSummaryInput {
  commandJson: string;
  envJson: string;
  image: string;
  operationConfigHash: string;
  operationsJson: string;
  portsJson: string;
  readinessJson: string;
  runtimeDefinitionHash: string;
  volumesJson: string;
}

interface DeploymentResourceRuntimeSummaryInput {
  status: ResourceRuntimeStatus | 'deleting' | 'starting';
}

export interface EnvironmentSummaryInput {
  createdAt: Date;
  id: string;
  name: string;
  projectId: string;
  updatedAt: Date;
}

export interface OperationSummaryInput {
  completedAt: Date | null;
  createdAt: Date;
  id: string;
  status: OperationStatus;
  targetId: string;
  targetType: string;
  type: string;
}

export interface OrganizationSummaryInput {
  id: string;
  name: string;
  slug: string;
}

export interface ProjectSummaryInput {
  archivedAt: Date | null;
  createdAt: Date;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export type WorkerClaimDeploymentResponseInput = WorkerClaimedDeploymentInput | null;

export interface WorkerClaimedDeploymentInput {
  buildEnv: BuildEnvMap;
  deployment: DeploymentSummaryInput;
  routeHost: string;
  run: ResolvedCompartmentServiceRunConfig;
}

export interface DeploymentReadEnvironmentSummaryInput {
  name: string;
}

export interface DeploymentReadProjectSummaryInput {
  name: string;
}

export interface DeploymentRunEventInput {
  createdAt: Date;
  deploymentId: string | null;
  id: string;
  level: DeploymentRunLogLevel;
  message: string;
  status: DeploymentRunStepStatus | null;
  stepKey: DeploymentRunStepKey;
  stream: DeploymentLogStream;
}

export interface DeploymentRunInput {
  createdAt: Date;
  id: string;
  label: string | null;
  sourceBindingSnapshotJson: string | null;
  sourceCommitSha: string | null;
  sourceEventId: string | null;
  sourceRepositorySnapshotJson: string | null;
  sourceResolutionTaskId: string | null;
  triggerType: DeploymentRunTriggerType;
}

export interface DeploymentRunLogsResponseInput {
  deployments: DeploymentSummaryInput[];
  environmentName: string;
  lineEvents: DeploymentRunEventInput[];
  projectName: string;
  run: DeploymentRunInput;
  runDeployments: DeploymentSummaryInput[];
  stepEvents: DeploymentRunEventInput[];
}
