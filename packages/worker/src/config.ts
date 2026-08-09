import {
  buildCompartmentArtifactRegistryAddress,
  buildInternalHttpUrl,
  parseOptionalTrustedOutboundHostList,
} from '@compartment/utils';
import type { KubeLeaderElectionConfig, KubeWorkloadScheduling } from '@compartment/kube-runtime';
import { z } from 'zod';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';
import type { TenantSecretsKeyring } from './tenant-secret-environment.types';
import type {
  WorkerBuildConfig,
  WorkerBuildQueueConfig,
  WorkerBuildResourceRequirements,
  WorkerConfig,
  WorkerCustomDomainConfig,
  WorkerProcessConfig,
} from './config.types';
import { readBuildWorkloadScheduling, readTenantWorkloadScheduling } from './tenant-workload-scheduling';

export type {
  WorkerBuildConfig,
  WorkerBuildSandboxConfig,
  WorkerConfig,
  WorkerCustomDomainConfig,
  WorkerProcessConfig,
} from './config.types';

interface WorkerProcessConfigEnvironment {
  COMPARTMENT_API_INTERNAL_HOST: string;
  COMPARTMENT_API_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: string;
  COMPARTMENT_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  COMPARTMENT_LEADER_ELECTION_IDENTITY: string;
  COMPARTMENT_LEADER_ELECTION_LEASE_DURATION_MS: number;
  COMPARTMENT_LEADER_ELECTION_RENEW_DEADLINE_MS: number;
  COMPARTMENT_LEADER_ELECTION_RETRY_PERIOD_MS: number;
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: number;
  COMPARTMENT_USAGE_METERING_INTERVAL_MS: number;
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: string;
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

interface WorkerBuildConfigEnvironment extends WorkerProcessConfigEnvironment {
  COMPARTMENT_BUILDKIT_GC_KEEP_STORAGE_MB: number;
  COMPARTMENT_BUILDKIT_RESOURCES: string;
  COMPARTMENT_BUILD_NAMESPACE: string;
  COMPARTMENT_BUILD_RUNNER_IMAGE: string;
  COMPARTMENT_BUILD_RUNNER_RESOURCES: string;
  COMPARTMENT_BUILD_TIMEOUT_MS: number;
  COMPARTMENT_KUBE_BUILD_SCHEDULING: string;
}

interface WorkerConfigEnvironment extends WorkerBuildConfigEnvironment {
  COMPARTMENT_CADDY_SERVICE_NAME: string;
  COMPARTMENT_INGRESS_CLASS_NAME: string;
  COMPARTMENT_TLS_ISSUER_KIND: 'Issuer' | 'ClusterIssuer';
  COMPARTMENT_TLS_ISSUER_NAME: string;
  COMPARTMENT_PLATFORM_NAMESPACE: string;
  COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS: number;
  COMPARTMENT_TENANT_SECRETS_KEK: string;
  COMPARTMENT_TENANT_SECRETS_PREVIOUS_KEK?: string | undefined;
  COMPARTMENT_KUBE_TENANT_SCHEDULING?: string | undefined;
  COMPARTMENT_MAX_CONCURRENT_BUILDS: number;
  COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_ORGANIZATION: number;
}

interface WorkerTrustedOutboundHostsEnvironment {
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

const workerProcessConfigSchema: z.ZodType<WorkerProcessConfigEnvironment> = z.object({
  COMPARTMENT_API_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_API_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: z.string().min(32),
  COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  COMPARTMENT_LEADER_ELECTION_IDENTITY: z.string().min(1),
  COMPARTMENT_LEADER_ELECTION_LEASE_DURATION_MS: z.coerce.number().int().positive(),
  COMPARTMENT_LEADER_ELECTION_RENEW_DEADLINE_MS: z.coerce.number().int().positive(),
  COMPARTMENT_LEADER_ELECTION_RETRY_PERIOD_MS: z.coerce.number().int().positive(),
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  COMPARTMENT_USAGE_METERING_INTERVAL_MS: z.coerce.number().int().positive(),
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.string().min(1),
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: z.string().optional(),
});

const buildResourceRequirementsSchema = z
  .object({ limits: z.object({ memory: z.string().trim().min(1) }).passthrough() })
  .passthrough();

const workerBuildConfigSchema: z.ZodType<WorkerBuildConfigEnvironment> = workerProcessConfigSchema.and(
  z.object({
    COMPARTMENT_BUILDKIT_GC_KEEP_STORAGE_MB: z.coerce.number().int().positive(),
    COMPARTMENT_BUILDKIT_RESOURCES: z.string().trim().min(1),
    COMPARTMENT_BUILD_NAMESPACE: z.string().trim().min(1),
    COMPARTMENT_BUILD_RUNNER_IMAGE: z.string().trim().min(1),
    COMPARTMENT_BUILD_RUNNER_RESOURCES: z.string().trim().min(1),
    COMPARTMENT_BUILD_TIMEOUT_MS: z.coerce.number().int().positive(),
    COMPARTMENT_KUBE_BUILD_SCHEDULING: z.string().trim().min(1),
  }),
);

const workerConfigSchema: z.ZodType<WorkerConfigEnvironment> = workerBuildConfigSchema.and(
  z.object({
    COMPARTMENT_CADDY_SERVICE_NAME: z.string().min(1),
    COMPARTMENT_INGRESS_CLASS_NAME: z.string().min(1),
    COMPARTMENT_TLS_ISSUER_KIND: z.enum(['Issuer', 'ClusterIssuer']),
    COMPARTMENT_TLS_ISSUER_NAME: z.string().min(1),
    COMPARTMENT_PLATFORM_NAMESPACE: z.string().min(1),
    COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS: z.coerce.number().int().positive(),
    COMPARTMENT_TENANT_SECRETS_KEK: z.string().regex(/^[0-9a-fA-F]{64}$/),
    COMPARTMENT_TENANT_SECRETS_PREVIOUS_KEK: z.union([z.literal(''), z.string().regex(/^[0-9a-fA-F]{64}$/)]).optional(),
    COMPARTMENT_KUBE_TENANT_SCHEDULING: z.string().min(1).optional(),
    COMPARTMENT_MAX_CONCURRENT_BUILDS: z.coerce.number().int().positive(),
    COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_ORGANIZATION: z.coerce.number().int().positive(),
  }),
);

export function workerLeaderElectionConfig(
  processConfig: WorkerProcessConfig,
  leaseName: string,
  namespace: string,
): KubeLeaderElectionConfig {
  return { ...processConfig.leaderElection, leaseName, namespace };
}

export function readWorkerProcessConfig(env: NodeJS.ProcessEnv = process.env): WorkerProcessConfig {
  const parsed: WorkerProcessConfigEnvironment = workerProcessConfigSchema.parse(env);
  readWorkerTrustedOutboundHosts(parsed);
  return buildWorkerProcessConfig(parsed);
}

export function readWorkerBuildConfig(env: NodeJS.ProcessEnv = process.env): WorkerBuildConfig {
  const parsed: WorkerBuildConfigEnvironment = workerBuildConfigSchema.parse(env);
  readWorkerTrustedOutboundHosts(parsed);
  return buildWorkerBuildConfig(parsed);
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed: WorkerConfigEnvironment = workerConfigSchema.parse(env);
  readWorkerTrustedOutboundHosts(parsed);
  const tenantScheduling: KubeWorkloadScheduling | undefined = readTenantWorkloadScheduling(
    parsed.COMPARTMENT_KUBE_TENANT_SCHEDULING,
  );

  return {
    ...buildWorkerBuildConfig(parsed),
    buildQueue: buildWorkerBuildQueueConfig(parsed),
    customDomains: buildWorkerCustomDomainConfig(parsed),
    deploymentInfrastructureTimeoutMs: parsed.COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS,
    ...(tenantScheduling === undefined ? {} : { tenantScheduling }),
    tenantSecretsKek: readTenantSecretsKeyring(parsed),
    usageMeteringIntervalMs: parsed.COMPARTMENT_USAGE_METERING_INTERVAL_MS,
  };
}

function buildWorkerBuildQueueConfig(parsed: WorkerConfigEnvironment): WorkerBuildQueueConfig {
  return {
    maximumConcurrentBuilds: parsed.COMPARTMENT_MAX_CONCURRENT_BUILDS,
    maximumConcurrentBuildsPerOrganization: parsed.COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_ORGANIZATION,
  };
}

function buildWorkerCustomDomainConfig(parsed: WorkerConfigEnvironment): WorkerCustomDomainConfig {
  return {
    caddyServiceName: parsed.COMPARTMENT_CADDY_SERVICE_NAME,
    ingressClassName: parsed.COMPARTMENT_INGRESS_CLASS_NAME,
    issuerRef: {
      kind: parsed.COMPARTMENT_TLS_ISSUER_KIND,
      name: parsed.COMPARTMENT_TLS_ISSUER_NAME,
    },
    namespace: parsed.COMPARTMENT_PLATFORM_NAMESPACE,
  };
}

function readTenantSecretsKeyring(parsed: WorkerConfigEnvironment): TenantSecretsKeyring {
  const previous: string | undefined = parsed.COMPARTMENT_TENANT_SECRETS_PREVIOUS_KEK;
  return {
    current: Buffer.from(parsed.COMPARTMENT_TENANT_SECRETS_KEK, 'hex'),
    ...(previous === undefined || previous === '' ? {} : { previous: Buffer.from(previous, 'hex') }),
  };
}

function buildWorkerBuildConfig(parsed: WorkerBuildConfigEnvironment): WorkerBuildConfig {
  return {
    ...buildWorkerProcessConfig(parsed),
    buildSandbox: {
      buildKitResources: readResourceRequirements(
        parsed.COMPARTMENT_BUILDKIT_RESOURCES,
        'COMPARTMENT_BUILDKIT_RESOURCES',
      ),
      gcKeepStorageMb: parsed.COMPARTMENT_BUILDKIT_GC_KEEP_STORAGE_MB,
      namespace: parsed.COMPARTMENT_BUILD_NAMESPACE,
      runnerImage: parsed.COMPARTMENT_BUILD_RUNNER_IMAGE,
      runnerResources: readResourceRequirements(
        parsed.COMPARTMENT_BUILD_RUNNER_RESOURCES,
        'COMPARTMENT_BUILD_RUNNER_RESOURCES',
      ),
      scheduling: readBuildWorkloadScheduling(parsed.COMPARTMENT_KUBE_BUILD_SCHEDULING),
      timeoutMs: parsed.COMPARTMENT_BUILD_TIMEOUT_MS,
    },
  };
}

function readResourceRequirements(value: string, name: string): WorkerBuildResourceRequirements {
  try {
    return buildResourceRequirementsSchema.parse(JSON.parse(value));
  } catch {
    throw new Error(`${name} must be a JSON object declaring limits.memory.`);
  }
}

export function readWorkerTrustedOutboundHosts(env: WorkerTrustedOutboundHostsEnvironment = process.env): string[] {
  return parseOptionalTrustedOutboundHostList(
    env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS,
    'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
  );
}

function buildWorkerProcessConfig(parsed: WorkerProcessConfigEnvironment): WorkerProcessConfig {
  return {
    apiUrl: buildInternalHttpUrl(parsed.COMPARTMENT_API_INTERNAL_HOST, parsed.COMPARTMENT_API_PORT),
    artifactRegistry: readWorkerArtifactRegistryConfig(parsed),
    logLevel: parsed.COMPARTMENT_LOG_LEVEL,
    leaderElection: {
      identity: parsed.COMPARTMENT_LEADER_ELECTION_IDENTITY,
      leaseDurationMs: parsed.COMPARTMENT_LEADER_ELECTION_LEASE_DURATION_MS,
      renewDeadlineMs: parsed.COMPARTMENT_LEADER_ELECTION_RENEW_DEADLINE_MS,
      retryPeriodMs: parsed.COMPARTMENT_LEADER_ELECTION_RETRY_PERIOD_MS,
    },
    pollIntervalMs: parsed.COMPARTMENT_WORKER_POLL_INTERVAL_MS,
    runtimeControlToken: parsed.COMPARTMENT_RUNTIME_CONTROL_TOKEN,
  };
}

function readWorkerArtifactRegistryConfig(parsed: WorkerProcessConfigEnvironment): WorkerArtifactRegistryConfig {
  return {
    address: buildCompartmentArtifactRegistryAddress(
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_HOST,
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_PORT,
    ),
    credentialSigningKey: parsed.COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY,
    internalAddress: parsed.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST,
    internalUrl: parsed.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL,
  };
}
