import type {
  AppRouteAccessMode,
  DeploymentLogLine,
  DeploymentLatestRunLogsQuery,
  DeploymentRunLogsByIdQuery,
  CompartmentAuthoredDescriptor,
  CompartmentRoutesFile,
  CompartmentServiceConnections,
  ResolvedCompartmentServiceBuildConfig,
  ResolvedCompartmentServiceRunConfig,
  CompartmentServiceKind,
  ResolvedOptionalCompartmentServiceReleaseConfig,
  ResolvedOptionalServiceReadinessConfig,
} from '@compartment/contracts';
import type { DeploymentJoinedRow, EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import type { ProjectRow } from '../queries/projects.query.types';
import type {
  DeploymentInspectTargetInput,
  DeploymentSummaryInput,
  EnvironmentSummaryInput,
  ProjectSummaryInput,
  WorkerClaimedDeploymentInput,
} from './presenter.types';

export interface ResolvedDescriptorService {
  accessMode: AppRouteAccessMode;
  build: ResolvedCompartmentServiceBuildConfig;
  connections: CompartmentServiceConnections;
  kind: CompartmentServiceKind;
  name: string;
  path: string;
  readiness: ResolvedOptionalServiceReadinessConfig;
  release: ResolvedOptionalCompartmentServiceReleaseConfig;
  run: ResolvedCompartmentServiceRunConfig;
}

export interface ResolvedProjectContext {
  descriptorService?: ResolvedDescriptorService | undefined;
  environment: EnvironmentRow;
  organization: OrganizationRow;
  project: ProjectRow;
  service: ProjectServiceRow;
}

export interface ResolvedExistingBuildTargetContext {
  environmentId: string | null;
  organizationId: string | null;
  serviceId: string | null;
}

export interface DeploymentSourceProvenance {
  sourceAutomationPrincipalId: string;
  sourceBindingId: string;
  sourceBindingSnapshotJson: string;
  sourceCommitSha: string;
  sourceEventId: string;
  sourceId: string;
  sourceKind: string;
  sourceRepositorySnapshotJson: string;
  sourceResolutionTaskId: string;
}

export interface ResolvedEnvironmentContext {
  environment: EnvironmentRow;
  organization: OrganizationRow;
  project: ProjectRow;
}

export interface ResolvedProjectLookupContext {
  organization: OrganizationRow;
  project: ProjectRow;
}

export interface DeployInputContext {
  actorPrincipalId: string;
  descriptor: CompartmentAuthoredDescriptor;
  environmentName?: string | undefined;
  label?: string | undefined;
  onboardingSessionId?: string | undefined;
  organizationId: string;
  organizationSlug: string;
  routes?: CompartmentRoutesFile | undefined;
  serviceName?: string | undefined;
  sourceProvenance?: DeploymentSourceProvenance | undefined;
  sourceUploadId: string;
}

interface StatusLookupInputBase {
  environmentName: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
}

export interface DeploymentIdStatusLookupInput extends StatusLookupInputBase {
  deploymentId: string;
  mode: 'deployment';
  serviceName?: string | undefined;
}

export interface ServiceStatusLookupInput extends StatusLookupInputBase {
  mode: 'service';
  serviceName: string;
}

export interface EnvironmentStatusLookupInput extends StatusLookupInputBase {
  mode: 'environment';
}

export type StatusLookupInput = DeploymentIdStatusLookupInput | ServiceStatusLookupInput | EnvironmentStatusLookupInput;

export interface DeploymentLogsLookupInput {
  environmentName?: string | undefined;
  organizationSlug: string;
  principalId: string;
  projectName: string;
  serviceName?: string | undefined;
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface DeploymentLatestRunLogsLookupInput
  extends DeploymentLogsLookupInput, Pick<DeploymentLatestRunLogsQuery, 'selector'> {}

export interface DeploymentRunLogsByIdLookupInput
  extends DeploymentLogsLookupInput, Pick<DeploymentRunLogsByIdQuery, 'deploymentRunId' | 'selector'> {}

export type DeploymentRunLogsLookupInput = DeploymentLatestRunLogsLookupInput | DeploymentRunLogsByIdLookupInput;

export interface DeploymentStatusLookupResult {
  activeDeployments: DeploymentSummaryInput[];
  deployments: DeploymentSummaryInput[];
  environment: EnvironmentSummaryInput;
  project: ProjectSummaryInput;
}

export type DeploymentInspectTargetResult = DeploymentInspectTargetInput;

export interface DeploymentInspectLookupResult {
  activeDeployments: DeploymentInspectTargetResult[];
  deployments: DeploymentInspectTargetResult[];
  environment: EnvironmentSummaryInput;
  project: ProjectSummaryInput;
}

export interface DeploymentLogsContext {
  deployments: DeploymentJoinedRow[];
  environment: EnvironmentRow;
  project: ProjectRow;
}

export interface DeploymentLogsLookupResult {
  deployments: DeploymentSummaryInput[];
  environment: EnvironmentSummaryInput;
  lines: DeploymentLogLine[];
  project: ProjectSummaryInput;
}

export type ClaimedDeploymentContext = WorkerClaimedDeploymentInput;
