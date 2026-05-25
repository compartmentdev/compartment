import type { NodeResourceOperationRequest } from '@compartment/contracts';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ResourceBackupRow } from '../queries/resource-backups.query.types';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { EffectiveVariable } from './effective-variables.service.types';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import { buildNodeResourceOperationDefinition, type ResolvedResourceIntent } from './resources.service.helpers';
import type {
  ResourceEnvironmentContext,
  RunResourceBackupInput,
  RunResourceRestoreInput,
} from './resources.service.types';
import type { StoredResourceOperationConfig } from './resources.service.storage';

export type ResourceOperationKind = 'backup' | 'restore';

export interface ResourceBackupOperationContext {
  effectiveVariables: EffectiveVariable[];
  intent: ResolvedResourceIntent;
  operation: StoredResourceOperationConfig;
}

export async function resolveBackupOperationContext(
  input: RunResourceBackupInput,
): Promise<ResourceBackupOperationContext> {
  return await resolveResourceOperationContext(input.context, input.resource, 'backup');
}

export async function resolveRestoreOperationContext(
  input: RunResourceRestoreInput,
): Promise<ResourceBackupOperationContext> {
  return await resolveResourceOperationContext(input.context, input.resource, 'restore');
}

export async function resolveResourceOperationContext(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  operationKind: ResourceOperationKind,
): Promise<ResourceBackupOperationContext> {
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    context.environment.id,
    context.organization.id,
    resource.name,
  );
  const intent: ResolvedResourceIntent = resolveStoredResourceIntent(resource, effectiveVariables);

  return {
    effectiveVariables,
    intent,
    operation: requireResourceOperation(intent, operationKind),
  };
}

export function buildResourceOperationRequest(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  operationContext: ResourceBackupOperationContext,
  artifactHostPath: string,
): NodeResourceOperationRequest {
  return {
    artifactHostPath,
    definition: buildNodeResourceOperationDefinition(
      operationContext.intent,
      operationContext.operation,
      operationContext.effectiveVariables,
    ),
    environmentId: context.environment.id,
    environmentName: context.environment.name,
    projectId: context.project.id,
    projectName: context.project.name,
    readiness: operationContext.intent.readiness,
    resourceHostname: resource.hostname,
    resourceName: resource.name,
  };
}

export function requireBackupArtifactHostPath(backup: ResourceBackupRow): string {
  if (backup.artifactLocation !== null) {
    return backup.artifactLocation;
  }

  throw createInvalidDeployConfigError(`Backup ${backup.id} does not have an artifact location.`);
}

function requireResourceOperation(
  intent: ResolvedResourceIntent,
  operationKind: ResourceOperationKind,
): StoredResourceOperationConfig {
  const operation: StoredResourceOperationConfig | null = intent.operations[operationKind];
  if (operation === null) {
    throw createInvalidDeployConfigError(`Resource ${intent.name} does not define an ${operationKind} command.`);
  }

  return operation;
}
