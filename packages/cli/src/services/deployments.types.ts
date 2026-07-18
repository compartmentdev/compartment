import type {
  DeploymentLatestRunLogsQuery,
  DeploymentRunLogsByIdQuery,
  DeploymentStatusResponse,
  DeploymentMetricsSnapshot,
  ResourceSummary,
} from '@compartment/contracts';
import type { CommandProgressReporter } from './progress.types';

export type DeploymentStatusReporter = (status: DeploymentStatusResponse) => void;

export interface DeploymentStatusView extends DeploymentStatusResponse {
  metrics: DeploymentMetricsSnapshot;
}

export interface DeployCommandResult extends DeploymentStatusResponse {
  resources: ResourceSummary[];
}

export interface DeployCommandInput {
  cwd: string;
  detach?: boolean | undefined;
  environmentName?: string | undefined;
  label?: string | undefined;
  onStatusUpdate?: DeploymentStatusReporter | undefined;
  projectName?: string | undefined;
  reportProgress?: CommandProgressReporter | undefined;
  reportWarning?: CommandProgressReporter | undefined;
  serviceName?: string | undefined;
}

export interface StatusCommandInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface InspectCommandInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface LogsCommandInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
  since?: string | undefined;
}

export interface DeploymentLogsCommandInputBase {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
  since?: string | undefined;
}

export interface DeploymentLatestLogsCommandInput
  extends DeploymentLogsCommandInputBase, Pick<DeploymentLatestRunLogsQuery, 'selector'> {}

export interface DeploymentRunLogsByIdCommandInput
  extends DeploymentLogsCommandInputBase, Pick<DeploymentRunLogsByIdQuery, 'deploymentRunId' | 'selector'> {}

export type DeploymentLogsCommandInput = DeploymentLatestLogsCommandInput | DeploymentRunLogsByIdCommandInput;

export interface DeploymentPollContext {
  environmentName: string;
  projectName: string;
  serviceName?: string | undefined;
}

export interface DeploymentStatusBatchResult {
  aggregatedStatus: DeploymentStatusResponse;
  completed: boolean;
  statuses: DeploymentStatusResponse[];
}
