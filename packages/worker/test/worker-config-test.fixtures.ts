import type { WorkerConfig } from '../src/config';
import type {
  KubeDataWorkloadScheduling,
  OrganizationQuotaCapacity,
  ProjectNamespaceResourceConfiguration,
} from '@compartment/kube-runtime';
import type { EdgePodLabels } from '../src/project-network-policy';
import type { WorkerArtifactRegistryConfig } from '../src/worker-artifact-registry.types';
import { testTenantSecretsKek } from './tenant-secret-test.fixtures';

/** The Caddy Pod labels the chart renders into `COMPARTMENT_EDGE_POD_LABELS`, as the worker receives them. */
export const testEdgePodLabels: EdgePodLabels = {
  'app.kubernetes.io/component': 'caddy',
  'app.kubernetes.io/instance': 'compartment',
  'app.kubernetes.io/name': 'compartment',
};

export const testEdgePodLabelsJson: string = JSON.stringify(testEdgePodLabels);

export const testOrganizationQuota: OrganizationQuotaCapacity = {
  limitsCpu: '8',
  limitsMemory: '8Gi',
  requestsCpu: '2',
  requestsMemory: '2Gi',
  requestsStorage: '20Gi',
};

export const testDataScheduling: KubeDataWorkloadScheduling = {
  nodeSelector: { 'compartment.dev/node-pool': 'data' },
  runtimeClassName: 'gvisor',
  tolerations: [],
};

export const testProjectResourceConfiguration: ProjectNamespaceResourceConfiguration = {
  containerDefaults: {
    limit: { cpu: '1', memory: '512Mi' },
    request: { cpu: '50m', memory: '512Mi' },
  },
  quota: testOrganizationQuota,
};

/**
 * The one worker configuration test doubles start from. Every field a test does not name is
 * irrelevant to it, so a new required field lands here instead of in each suite.
 */
export function createWorkerTestConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    artifactRegistry: createArtifactRegistryTestConfig(),
    buildSandbox: {
      buildKitConfigMapName: 'compartment-buildkit',
      buildKitResources: { limits: { memory: '3Gi' } },
      gcKeepStorageMb: 1024,
      namespace: 'compartment-build',
      runnerResources: { limits: { memory: '1Gi' } },
      scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
      timeoutMs: 900_000,
    },
    buildQueue: { maximumConcurrentBuilds: 2, maximumConcurrentBuildsPerOrganization: 1 },
    customDomains: {
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    },
    dataScheduling: testDataScheduling,
    deploymentInfrastructureTimeoutMs: 600_000,
    organizationQuota: testOrganizationQuota,
    logLevel: 'silent',
    leaderElection: {
      identity: 'worker-1',
      leaseDurationMs: 15_000,
      renewDeadlineMs: 10_000,
      retryPeriodMs: 2_000,
    },
    pollIntervalMs: 1000,
    runtimeControlToken: 'worker-secret',
    tenantSecretsKek: testTenantSecretsKek,
    usageMeteringIntervalMs: 60_000,
    workerImage: 'compartment-worker@sha256:runner',
    ...overrides,
  };
}

export function createArtifactRegistryTestConfig(
  overrides: Partial<WorkerArtifactRegistryConfig> = {},
): WorkerArtifactRegistryConfig {
  return {
    address: '127.0.0.1:5517',
    credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
    internalAddress: 'registry:5000',
    internalUrl: 'http://registry:5000',
    ...overrides,
  };
}
