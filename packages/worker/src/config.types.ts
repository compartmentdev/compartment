import type { KubeIssuerReference, KubeWorkloadScheduling } from '@compartment/kube-runtime';
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
}

export interface WorkerBuildSandboxConfig {
  gcKeepStorageMb: number;
  buildKitResources: object;
  namespace: string;
  runnerImage: string;
  runnerResources: object;
  scheduling: WorkerBuildScheduling;
  timeoutMs: number;
}

export interface WorkerBuildScheduling extends KubeWorkloadScheduling {
  runtimeClassName: string;
}

export interface WorkerConfig extends WorkerBuildConfig {
  buildQueue: WorkerBuildQueueConfig;
  customDomains: WorkerCustomDomainConfig;
  deploymentInfrastructureTimeoutMs: number;
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
