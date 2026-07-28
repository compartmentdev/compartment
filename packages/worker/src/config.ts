import {
  buildCompartmentArtifactRegistryAddress,
  buildInternalHttpUrl,
  parseOptionalTrustedOutboundHostList,
} from '@compartment/utils';
import type { DomainIssuerReference } from '@compartment/contracts';
import { z } from 'zod';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

interface WorkerProcessConfigEnvironment {
  COMPARTMENT_API_INTERNAL_HOST: string;
  COMPARTMENT_API_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: string;
  COMPARTMENT_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: number;
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: string;
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

interface WorkerConfigEnvironment extends WorkerProcessConfigEnvironment {
  BUILDKIT_ADDR: string;
  COMPARTMENT_CADDY_SERVICE_NAME: string;
  COMPARTMENT_INGRESS_CLASS_NAME: string;
  COMPARTMENT_TLS_ISSUER_KIND: 'Issuer' | 'ClusterIssuer';
  COMPARTMENT_TLS_ISSUER_NAME: string;
  COMPARTMENT_PLATFORM_NAMESPACE: string;
}

interface WorkerTrustedOutboundHostsEnvironment {
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

const workerProcessConfigSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_API_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_API_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: z.string().min(32),
  COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.string().min(1),
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: z.string().optional(),
});

const workerConfigSchema: z.ZodTypeAny = workerProcessConfigSchema.and(
  z.object({
    BUILDKIT_ADDR: z.string().trim().min(1),
    COMPARTMENT_CADDY_SERVICE_NAME: z.string().min(1),
    COMPARTMENT_INGRESS_CLASS_NAME: z.string().min(1),
    COMPARTMENT_TLS_ISSUER_KIND: z.enum(['Issuer', 'ClusterIssuer']),
    COMPARTMENT_TLS_ISSUER_NAME: z.string().min(1),
    COMPARTMENT_PLATFORM_NAMESPACE: z.string().min(1),
  }),
);

export interface WorkerProcessConfig {
  apiUrl: string;
  artifactRegistry: WorkerArtifactRegistryConfig;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  pollIntervalMs: number;
  runtimeControlToken: string;
}

export interface WorkerConfig extends WorkerProcessConfig {
  buildKitAddress: string;
  customDomains: WorkerCustomDomainConfig;
}

export interface WorkerCustomDomainConfig {
  caddyServiceName: string;
  ingressClassName: string;
  issuerRef: DomainIssuerReference;
  namespace: string;
}

export function readWorkerProcessConfig(env: NodeJS.ProcessEnv = process.env): WorkerProcessConfig {
  const parsed: WorkerProcessConfigEnvironment = workerProcessConfigSchema.parse(env) as WorkerProcessConfigEnvironment;
  readWorkerTrustedOutboundHosts(parsed);
  return buildWorkerProcessConfig(parsed);
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed: WorkerConfigEnvironment = workerConfigSchema.parse(env) as WorkerConfigEnvironment;
  readWorkerTrustedOutboundHosts(parsed);

  return {
    ...buildWorkerProcessConfig(parsed),
    buildKitAddress: parsed.BUILDKIT_ADDR,
    customDomains: {
      caddyServiceName: parsed.COMPARTMENT_CADDY_SERVICE_NAME,
      ingressClassName: parsed.COMPARTMENT_INGRESS_CLASS_NAME,
      issuerRef: {
        kind: parsed.COMPARTMENT_TLS_ISSUER_KIND,
        name: parsed.COMPARTMENT_TLS_ISSUER_NAME,
      },
      namespace: parsed.COMPARTMENT_PLATFORM_NAMESPACE,
    },
  };
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
