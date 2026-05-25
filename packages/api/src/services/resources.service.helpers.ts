import { createHash } from 'node:crypto';
import {
  buildCompartmentResourceHostname,
  type CompartmentAuthoredResourceConfig,
  type CompartmentResourceOutputs,
  type CompartmentResourceReadinessConfig,
  type CompartmentResourceVolumeValue,
  type CompartmentResourceVolumes,
  type NodeResourceEnvValue,
  type NodeResourceOperationDefinition,
  type NodeResourceRequest,
  type NodeResourceRuntimeDefinition,
  type NodeResourceVolume,
  type ResourceEnvSourceSummary,
  type ResourceReadinessSummary,
  type ResourceRestartPolicy,
  type ResourceVolumeSummary,
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

export interface ResolvedResourceIntent {
  command: string[];
  env: ResourceEnvSourceSummary[];
  hostname: string;
  image: string;
  name: string;
  operationConfigHash: string;
  operations: StoredResourceOperationsConfig;
  outputs: CompartmentResourceOutputs;
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  restartPolicy: 'no' | 'on-failure' | 'unless-stopped';
  runtimeEnv: NodeResourceEnvValue[];
  runtimeHash: string;
  storedEnv: StoredResourceEnvSource[];
  volumes: ResourceVolumeSummary[];
}

export interface ResourceIntentParts {
  command: string[];
  env: ResourceEnvSourceSummary[];
  hostname: string;
  image: string;
  name: string;
  operations: StoredResourceOperationsConfig;
  outputs: CompartmentResourceOutputs;
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  restartPolicy: ResourceRestartPolicy;
  runtimeEnv: NodeResourceEnvValue[];
  storedEnv: StoredResourceEnvSource[];
  volumes: ResourceVolumeSummary[];
}

interface ResourceIntentDefaults {
  command: string[];
  operations: StoredResourceOperationsConfig;
  outputs: CompartmentResourceOutputs;
  ports: number[];
  storedEnv: StoredResourceEnvSource[];
  volumes: ResourceVolumeSummary[];
}

export function resolveResourceIntent(
  projectName: string,
  environmentName: string,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
  variables: EffectiveVariable[],
): ResolvedResourceIntent {
  const command: string[] = resource.command ?? [];
  const ports: number[] = resource.ports ?? [];
  const volumes: ResourceVolumeSummary[] = buildResourceVolumes(resource.volumes ?? {});
  const storedEnv: StoredResourceEnvSource[] = buildStoredResourceEnv(resource);
  const operations: StoredResourceOperationsConfig = buildStoredResourceOperations(resource);
  const outputs: CompartmentResourceOutputs = resource.outputs ?? {};

  return createResolvedResourceIntent(
    buildResourceIntentParts(projectName, environmentName, resourceName, resource, variables, {
      command,
      operations,
      outputs,
      ports,
      storedEnv,
      volumes,
    }),
  );
}

function buildResourceIntentParts(
  projectName: string,
  environmentName: string,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
  variables: EffectiveVariable[],
  defaults: ResourceIntentDefaults,
): ResourceIntentParts {
  return {
    command: defaults.command,
    env: buildResourceEnvSummary(defaults.storedEnv),
    hostname: buildCompartmentResourceHostname(projectName, environmentName, resourceName),
    image: resource.image,
    name: resourceName,
    operations: defaults.operations,
    outputs: defaults.outputs,
    ports: defaults.ports,
    readiness: resolveResourceReadiness(resource.readiness),
    restartPolicy: resource.restart?.policy ?? 'unless-stopped',
    runtimeEnv: resolveResourceRuntimeEnv(defaults.storedEnv, variables),
    storedEnv: defaults.storedEnv,
    volumes: defaults.volumes,
  };
}

export function createResolvedResourceIntent(parts: ResourceIntentParts): ResolvedResourceIntent {
  return {
    command: parts.command,
    env: parts.env,
    hostname: parts.hostname,
    image: parts.image,
    name: parts.name,
    operationConfigHash: createResourceOperationConfigHash(parts.operations),
    operations: parts.operations,
    outputs: parts.outputs,
    ports: parts.ports,
    readiness: parts.readiness,
    restartPolicy: parts.restartPolicy,
    runtimeEnv: parts.runtimeEnv,
    runtimeHash: buildResourceRuntimeHash(parts),
    storedEnv: parts.storedEnv,
    volumes: parts.volumes,
  };
}

function buildResourceRuntimeHash(parts: ResourceIntentParts): string {
  return createResourceRuntimeHash(
    parts.image,
    parts.command,
    parts.ports,
    parts.runtimeEnv,
    parts.volumes,
    parts.hostname,
  );
}

export function buildNodeResourceOperationDefinition(
  intent: ResolvedResourceIntent,
  operation: StoredResourceOperationConfig,
  effectiveVariables: EffectiveVariable[],
): NodeResourceOperationDefinition {
  return {
    command: operation.command,
    env: resolveResourceOperationRuntimeEnv(intent.storedEnv, operation, effectiveVariables),
    image: operation.image ?? intent.image,
  };
}

export function buildNodeResourceRequest(
  projectId: string,
  projectName: string,
  environmentId: string,
  environmentName: string,
  intent: ResolvedResourceIntent,
): NodeResourceRequest {
  return {
    definition: buildNodeResourceDefinition(intent),
    environmentId,
    environmentName,
    hostname: intent.hostname,
    projectId,
    projectName,
    resourceName: intent.name,
    volumes: intent.volumes.map((volume: ResourceVolumeSummary): NodeResourceVolume => ({ ...volume })),
  };
}

function buildNodeResourceDefinition(intent: ResolvedResourceIntent): NodeResourceRuntimeDefinition {
  return {
    command: intent.command,
    env: intent.runtimeEnv,
    image: intent.image,
    ports: intent.ports,
    readiness: intent.readiness,
    restart: {
      policy: intent.restartPolicy,
    },
  };
}

function buildResourceVolumes(volumes: CompartmentResourceVolumes): ResourceVolumeSummary[] {
  const entries: [string, CompartmentResourceVolumeValue][] = Object.entries(volumes);

  return entries.map(
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

function createResourceRuntimeHash(
  image: string,
  command: string[],
  ports: number[],
  env: NodeResourceEnvValue[],
  volumes: ResourceVolumeSummary[],
  hostname: string,
): string {
  return createHash('sha256').update(JSON.stringify({ command, env, hostname, image, ports, volumes })).digest('hex');
}

function createResourceOperationConfigHash(operations: StoredResourceOperationsConfig): string {
  return createHash('sha256').update(serializeResourceOperations(operations)).digest('hex');
}
