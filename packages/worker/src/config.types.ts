import type {
  KubeDataWorkloadScheduling,
  KubeIssuerReference,
  KubeWorkloadScheduling,
  OrganizationQuotaCapacity,
} from '@compartment/kube-runtime';
import type { TenantSecretsKeyring } from './tenant-secret-environment.types';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

export interface WorkerProcessConfig {
  apiUrl: string;
  artifactRegistry: WorkerArtifactRegistryConfig;
  leaderElection: WorkerLeaderElectionProcessConfig;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  pollIntervalMs: number;
  runtimeControlToken: string;
}

export interface WorkerLeaderElectionProcessConfig {
  identity: string;
  leaseDurationMs: number;
  renewDeadlineMs: number;
  retryPeriodMs: number;
}

export interface WorkerBuildConfig extends WorkerProcessConfig {
  buildSandbox: WorkerBuildSandboxConfig;
  /** The platform image this worker itself runs, reused for every container the worker injects into a tenant Pod. */
  workerImage: string;
}

export interface WorkerBuildSandboxConfig {
  buildKitConfigMapName: string;
  gcKeepStorageMb: number;
  buildKitResources: WorkerBuildResourceRequirements;
  namespace: string;
  runnerResources: WorkerBuildResourceRequirements;
  scheduling: WorkerBuildScheduling;
  timeoutMs: number;
}

/**
 * The build namespace ResourceQuota already requires every build container to declare limits, and
 * the memory limit is what funds the memory-backed build workspace, so the worker requires it and
 * projects the rest of the operator-configured requirements unchanged.
 */
export interface WorkerBuildResourceRequirements {
  limits: WorkerBuildResourceLimits;
}

export interface WorkerBuildResourceLimits {
  memory: string;
}

export interface WorkerBuildScheduling extends KubeWorkloadScheduling {
  runtimeClassName: string;
}

export interface WorkerConfig extends WorkerBuildConfig {
  buildQueue: WorkerBuildQueueConfig;
  customDomains: WorkerCustomDomainConfig;
  dataScheduling: KubeDataWorkloadScheduling;
  deploymentInfrastructureTimeoutMs: number;
  organizationQuota: OrganizationQuotaCapacity;
  tenantScheduling?: KubeWorkloadScheduling | undefined;
  tenantSecretsKek: TenantSecretsKeyring;
  usageMeteringIntervalMs: number;
}

export interface WorkerBuildQueueConfig {
  maximumConcurrentBuilds: number;
  maximumConcurrentBuildsPerOrganization: number;
}

export interface WorkerCustomDomainConfig {
  caddyServiceName: string;
  ingressClassName: string;
  issuerRef: KubeIssuerReference;
  namespace: string;
}
