import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
} from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';

export interface WorkerDeploymentEventContext {
  deploymentId: string;
  deploymentRunId: string;
  request: CompartmentRequester;
}

export interface AppendDeploymentEventInput {
  level?: DeploymentRunLogLevel | undefined;
  message: string;
  status?: DeploymentRunStepStatus | undefined;
  stepKey: DeploymentRunStepKey;
  stream?: DeploymentLogStream | undefined;
  timestamp?: string | undefined;
}
