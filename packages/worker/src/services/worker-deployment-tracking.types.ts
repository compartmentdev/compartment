import type {
  DeploymentLogStream,
  DeploymentRunLogLevel,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  RuntimeDrainState,
} from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';

export interface DeploymentDrainContext {
  drain?: RuntimeDrainState | undefined;
  drainingNodeSocketPath?: string | undefined;
}

export interface WorkerDeploymentEventContext {
  deploymentId: string;
  deploymentRunId: string;
  request: CompartmentRequester;
}

export interface AppendRuntimeEventInput {
  level?: DeploymentRunLogLevel | undefined;
  message: string;
  status?: DeploymentRunStepStatus | undefined;
  stepKey: DeploymentRunStepKey;
  stream?: DeploymentLogStream | undefined;
  timestamp?: string | undefined;
}
