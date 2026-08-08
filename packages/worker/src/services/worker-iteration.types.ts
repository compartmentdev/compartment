import type { WorkerClaimedDeployment } from '@compartment/contracts';
import type { KubeRuntime } from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerConfig } from '../config';

export interface AttemptedClaimedDeploymentResult {
  failureError?: Error;
  imageRef?: string;
}

export interface WorkerRequesterInput {
  apiUrl: string;
  internalToken: string;
}

export interface AttemptClaimedDeploymentCompletionInput {
  config: WorkerConfig;
  deployment: WorkerClaimedDeployment;
  request: CompartmentRequester;
  runtime: KubeRuntime;
}

export interface WorkerBuildTask {
  completion: Promise<void>;
}
