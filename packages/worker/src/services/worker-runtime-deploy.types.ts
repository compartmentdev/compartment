import type {
  NodeDeployResponse,
  WorkerClaimedDeployment,
  WorkerUpdateDeploymentRuntimeRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '@compartment/sdk';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import type { DeploymentDrainContext } from './worker-deployment-tracking.types';

export interface PreparedDeploymentResult {
  drainContext: DeploymentDrainContext;
  nodeResponse: NodeDeployResponse;
}

export interface PrepareBuiltDeploymentCompletionInput {
  artifactRegistry: WorkerArtifactRegistryConfig;
  deployment: WorkerClaimedDeployment;
  dockerNamespace: string;
  imageRef: string;
  request: CompartmentRequester;
  runtimeControlToken: string;
}

export interface ActiveRuntimeStateUpdate extends WorkerUpdateDeploymentRuntimeRequest {
  drain: null;
  promotionStage: 'active';
}
