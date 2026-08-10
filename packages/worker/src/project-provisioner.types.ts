import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';
import type { KubeLeaderElectionConfig, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import type { EdgePodLabels } from './project-network-policy';

export interface ProjectProvisionerConfig {
  apiUrl: string;
  artifactRegistry: WorkerArtifactRegistryConfig;
  edgeNamespace: string;
  edgePodLabels: EdgePodLabels;
  image: string;
  installationId: string;
  leaderElection: KubeLeaderElectionConfig;
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
