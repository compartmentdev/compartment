import type { WorkerClaimedDeployment } from '@compartment/contracts';
import type { CompartmentBinaryRequester, CompartmentRequester } from '@compartment/sdk';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';

export interface AttemptedClaimedDeploymentResult {
  failureError?: Error;
  imageRef?: string;
}

export interface WorkerRequesterInput {
  apiUrl: string;
  internalToken: string;
}

export interface AttemptClaimedDeploymentCompletionInput {
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  releaseArchiveRequest: CompartmentBinaryRequester;
  request: CompartmentRequester;
}
