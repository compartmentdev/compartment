import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';
import type { KubeWorkloadScheduling } from '@compartment/kube-runtime';

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
  tenantScheduling?: KubeWorkloadScheduling | undefined;
  workerServiceAccountName: string;
}
