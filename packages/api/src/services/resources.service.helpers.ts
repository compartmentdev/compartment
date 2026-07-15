import { createHash } from 'node:crypto';
import type {
  CompartmentAuthoredResourceConfig,
  CompartmentResourceOutputs,
  CompartmentResourceReadinessConfig,
  CompartmentResourceVolumeValue,
  CompartmentResourceVolumes,
  ResourceEnvSourceSummary,
  ResourceReadinessSummary,
  ResourceVolumeSummary,
} from '@compartment/contracts';
import type { EffectiveVariable } from './effective-variables.service.types';
import {
  buildResourceEnvSummary,
  buildStoredResourceEnv,
  buildStoredResourceOperations,
  resolveResourceOperationRuntimeEnv,
  resolveResourceRuntimeEnv,
  serializeResourceOperations,
  type StoredResourceEnvSource,
  type StoredResourceOperationConfig,
  type StoredResourceOperationsConfig,
} from './resources.service.storage';

export interface ResourceRuntimeEnvValue {
  keyName: string;
  value: string;
}

interface ResourceOperationDefinition {
  command: string;
  env: ResourceRuntimeEnvValue[];
  image: string;
}

export interface ResolvedResourceIntent {
  command: string[];
  env: ResourceEnvSourceSummary[];
  image: string;
  name: string;
  operationConfigHash: string;
  operations: StoredResourceOperationsConfig;
  outputs: CompartmentResourceOutputs;
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  runtimeEnv: ResourceRuntimeEnvValue[];
  runtimeHash: string;
  storedEnv: StoredResourceEnvSource[];
  volumes: ResourceVolumeSummary[];
}

export interface ResourceIntentParts {
  command: string[];
  env: ResourceEnvSourceSummary[];
  image: string;
  name: string;
  operations: StoredResourceOperationsConfig;
  outputs: CompartmentResourceOutputs;
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  runtimeEnv: ResourceRuntimeEnvValue[];
  storedEnv: StoredResourceEnvSource[];
  volumes: ResourceVolumeSummary[];
}

export function resolveResourceIntent(
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
  variables: EffectiveVariable[],
): ResolvedResourceIntent {
  const storedEnv: StoredResourceEnvSource[] = buildStoredResourceEnv(resource);

  return createResolvedResourceIntent({
    command: resource.command ?? [],
    env: buildResourceEnvSummary(storedEnv),
    image: resource.image,
    name: resourceName,
    operations: buildStoredResourceOperations(resource),
    outputs: resource.outputs ?? {},
    ports: resource.ports ?? [],
    readiness: resolveResourceReadiness(resource.readiness),
    runtimeEnv: resolveResourceRuntimeEnv(storedEnv, variables),
    storedEnv,
    volumes: buildResourceVolumes(resource.volumes ?? {}),
  });
}

export function createResolvedResourceIntent(parts: ResourceIntentParts): ResolvedResourceIntent {
  return {
    ...parts,
    operationConfigHash: createResourceOperationConfigHash(parts.operations),
    runtimeHash: createResourceRuntimeHash(parts),
  };
}

export function buildResourceOperationDefinition(
  intent: ResolvedResourceIntent,
  operation: StoredResourceOperationConfig,
  effectiveVariables: EffectiveVariable[],
): ResourceOperationDefinition {
  return {
    command: operation.command,
    env: resolveResourceOperationRuntimeEnv(intent.storedEnv, operation, effectiveVariables),
    image: operation.image ?? intent.image,
  };
}

function buildResourceVolumes(volumes: CompartmentResourceVolumes): ResourceVolumeSummary[] {
  return Object.entries(volumes).map(
    ([name, value]: [string, CompartmentResourceVolumeValue]): ResourceVolumeSummary => ({
      mountPath: typeof value === 'string' ? value : value.mountPath,
      name,
    }),
  );
}

function resolveResourceReadiness(
  readiness: CompartmentResourceReadinessConfig | undefined,
): ResourceReadinessSummary | null {
  if (readiness === undefined) {
    return null;
  }

  return {
    port: readiness.port,
    timeoutMs: readiness.timeoutMs ?? 30_000,
    type: 'tcp',
  };
}

function createResourceRuntimeHash(parts: ResourceIntentParts): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        command: parts.command,
        env: parts.runtimeEnv,
        image: parts.image,
        ports: parts.ports,
        volumes: parts.volumes,
      }),
    )
    .digest('hex');
}

function createResourceOperationConfigHash(operations: StoredResourceOperationsConfig): string {
  return createHash('sha256').update(serializeResourceOperations(operations)).digest('hex');
}
