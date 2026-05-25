import { buildCompartmentResourceHostname } from '@compartment/contracts';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { EffectiveVariable } from './effective-variables.service.types';
import {
  createResolvedResourceIntent,
  type ResolvedResourceIntent,
  type ResourceIntentParts,
} from './resources.service.helpers';
import {
  parseResourceCommand,
  parseResourceEnv,
  parseResourcePorts,
  parseResourceReadiness,
  parseResourceRestartPolicy,
  parseResourceVolumes,
  parseStoredResourceEnv,
  parseStoredResourceOperations,
  parseStoredResourceOutputs,
  resolveStoredResourceRuntimeEnv,
} from './resources.service.storage';

interface StoredResourceIntentTarget {
  environmentName: string;
  projectName: string;
  resourceName: string;
}

export function resolveStoredResourceIntent(
  resource: ProjectResourceRow,
  effectiveVariables: EffectiveVariable[],
  target?: StoredResourceIntentTarget,
): ResolvedResourceIntent {
  const parts: ResourceIntentParts = {
    command: parseResourceCommand(resource),
    env: parseResourceEnv(resource),
    hostname: resolveStoredResourceHostname(resource, target),
    image: resource.image,
    name: target?.resourceName ?? resource.name,
    operations: parseStoredResourceOperations(resource),
    outputs: parseStoredResourceOutputs(resource),
    ports: parseResourcePorts(resource),
    readiness: parseResourceReadiness(resource),
    restartPolicy: parseResourceRestartPolicy(resource),
    runtimeEnv: resolveStoredResourceRuntimeEnv(resource, effectiveVariables),
    storedEnv: parseStoredResourceEnv(resource),
    volumes: parseResourceVolumes(resource),
  };

  return target === undefined ? restoreStoredResourceHashes(resource, parts) : createResolvedResourceIntent(parts);
}

function restoreStoredResourceHashes(resource: ProjectResourceRow, parts: ResourceIntentParts): ResolvedResourceIntent {
  return {
    ...parts,
    operationConfigHash: resource.operationConfigHash,
    runtimeHash: resource.runtimeDefinitionHash,
  };
}

function resolveStoredResourceHostname(
  resource: ProjectResourceRow,
  target: StoredResourceIntentTarget | undefined,
): string {
  return target === undefined
    ? resource.hostname
    : buildCompartmentResourceHostname(target.projectName, target.environmentName, target.resourceName);
}
