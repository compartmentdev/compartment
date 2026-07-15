import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

export interface ProjectProvisionerConfig {
  apiUrl: string;
  artifactRegistry: WorkerArtifactRegistryConfig;
  edgeNamespace: string;
  image: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  platformNamespace: string;
  podCidr: string;
  pollIntervalMs: number;
  provisioningNamespace: string;
  runtimeControlToken: string;
  serviceCidr: string;
  workerServiceAccountName: string;
}
