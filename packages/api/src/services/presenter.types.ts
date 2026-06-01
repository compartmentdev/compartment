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
  ResolvedOptionalCompartmentServiceReleaseConfig,
  ResolvedCompartmentServiceRunConfig,
  ResolvedOptionalServiceReadinessConfig,
  ResourceRuntimeStatus,
  RuntimeActiveDeployment,
  RuntimeNetworkIntent,
} from '@compartment/contracts';
import type { BuildEnvMap } from './deployment-build.types';
import type { RuntimeEnvMap } from './deployment-runtime.types';

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
  containerId: string | null;
  drainDeadlineAt: Date | null;
  drainingContainerId: string | null;
  drainingDeploymentId: string | null;
  drainingNodeId: string | null;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  isActive: boolean;
  movementSourceDeploymentId: string | null;
  nodeId: string;
  promotionStage: DeploymentPromotionStage;
  status: DeploymentRuntimeStatus;
  upstreamHost: string | null;
  upstreamPort: number | null;
}

interface DeploymentRecordRouteSummaryInput {
  accessMode: AppRouteAccessMode;
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
  runtime: RuntimeActiveDeployment | null;
}

export interface DeploymentResourceSummaryInput
  extends DeploymentResourceDefinitionSummaryInput, DeploymentResourceRuntimeSummaryInput {
  createdAt: Date;
  environmentId: string;
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
  restartPolicy: string;
  runtimeDefinitionHash: string;
  volumesJson: string;
}

interface DeploymentResourceRuntimeSummaryInput {
  containerId: string | null;
  hostname: string;
  status: ResourceRuntimeStatus;
}

export interface EnvironmentSummaryInput {
  createdAt: Date;
  id: string;
  name: string;
  projectId: string;
  updatedAt: Date;
}

export interface NodeSummaryInput {
  id: string;
  name: string;
  nodeSocketPath: string;
  nodeVersion: string;
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

export interface PreviousDeploymentContextInput {
  deployment: DeploymentSummaryInput;
  node: NodeSummaryInput;
}

export type PreviousDeploymentInput = PreviousDeploymentContextInput | null;

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
  node: NodeSummaryInput;
  previousDeployment: PreviousDeploymentInput;
  readiness: ResolvedOptionalServiceReadinessConfig;
  release: ResolvedOptionalCompartmentServiceReleaseConfig;
  routeHost: string;
  run: ResolvedCompartmentServiceRunConfig;
  runtimeNetwork: RuntimeNetworkIntent;
  runtimeEnv: RuntimeEnvMap;
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
