import {
  buildCompartmentArtifactRegistryAddress,
  buildInternalHttpUrl,
  parseOptionalTrustedOutboundHostList,
} from '@compartment/utils';
import { z } from 'zod';
import type { WorkerArtifactRegistryConfig } from './worker-artifact-registry.types';

interface WorkerConfigEnvironment {
  BUILDKIT_ADDR: string;
  COMPARTMENT_API_INTERNAL_HOST: string;
  COMPARTMENT_API_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_MODE: 'bundled' | 'external';
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: string;
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: string;
  COMPARTMENT_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: number;
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: string;
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

interface WorkerTrustedOutboundHostsEnvironment {
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS?: string | undefined;
}

const workerConfigSchema: z.ZodTypeAny = z.object({
  BUILDKIT_ADDR: z.string().trim().min(1),
  COMPARTMENT_API_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_API_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_MODE: z.enum(['bundled', 'external']),
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: z.string().min(1),
  COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  COMPARTMENT_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive(),
  COMPARTMENT_RUNTIME_CONTROL_TOKEN: z.string().min(1),
  COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: z.string().optional(),
});

export interface WorkerConfig {
  apiUrl: string;
  artifactRegistry: WorkerArtifactRegistryConfig;
  buildKitAddress: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  pollIntervalMs: number;
  runtimeControlToken: string;
}

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed: WorkerConfigEnvironment = workerConfigSchema.parse(env) as WorkerConfigEnvironment;
  assertExternalRegistryUsesTls(parsed);
  readWorkerTrustedOutboundHosts(parsed);

  return {
    apiUrl: buildInternalHttpUrl(parsed.COMPARTMENT_API_INTERNAL_HOST, parsed.COMPARTMENT_API_PORT),
    artifactRegistry: readWorkerArtifactRegistryConfig(parsed),
    buildKitAddress: parsed.BUILDKIT_ADDR,
    logLevel: parsed.COMPARTMENT_LOG_LEVEL,
    pollIntervalMs: parsed.COMPARTMENT_WORKER_POLL_INTERVAL_MS,
    runtimeControlToken: parsed.COMPARTMENT_RUNTIME_CONTROL_TOKEN,
  };
}

function assertExternalRegistryUsesTls(parsed: WorkerConfigEnvironment): void {
  if (
    parsed.COMPARTMENT_ARTIFACT_REGISTRY_MODE === 'external' &&
    new URL(parsed.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL).protocol !== 'https:'
  ) {
    throw new Error('COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL must use HTTPS in external registry mode.');
  }
}

export function readWorkerTrustedOutboundHosts(env: WorkerTrustedOutboundHostsEnvironment = process.env): string[] {
  return parseOptionalTrustedOutboundHostList(
    env.COMPARTMENT_TRUSTED_OUTBOUND_HOSTS,
    'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
  );
}

function readWorkerArtifactRegistryConfig(parsed: WorkerConfigEnvironment): WorkerArtifactRegistryConfig {
  return {
    address: buildCompartmentArtifactRegistryAddress(
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_HOST,
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_PORT,
    ),
    internalUrl: parsed.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL,
    mode: parsed.COMPARTMENT_ARTIFACT_REGISTRY_MODE,
    readCredentials: {
      password: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD,
      username: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME,
    },
    writeCredentials: {
      password: parsed.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD,
      username: parsed.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME,
    },
  };
}
