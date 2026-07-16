import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { EffectiveVariable } from './effective-variables.service.types';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import type { ResolvedResourceIntent } from './resources.service.helpers';
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
