import type { CompartmentAuthoredResourceConfig } from '@compartment/contracts';
import { createProjectResourceWithExecutor, updateProjectResourceIntentWithExecutor } from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import type { EffectiveVariable } from './effective-variables.service.types';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { ensureGeneratedResourceVariables } from './resources-generated-variables.service';
import { createResourceInsert } from './resources-resource-insert.service';
import type { ResolvedResourceIntent } from './resources.service.helpers';
import type { ResourceEnvironmentContext } from './resources.service.types';
import {
  serializeResourceCommand,
  serializeResourceEnv,
  serializeResourceOperations,
  serializeResourceOutputs,
  serializeResourcePorts,
  serializeResourceReadiness,
  serializeResourceVolumes,
} from './resources.service.storage';

export async function prepareResourceEffectiveVariables(
  tx: ResourceTransaction,
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<EffectiveVariable[]> {
  return await ensureGeneratedResourceVariables({
    actorPrincipalId,
    context,
    effectiveVariables: await loadResourceEffectiveVariables(
      context.environment.id,
      context.organization.id,
      resourceName,
    ),
    resource,
    resourceName,
    tx,
  });
}

export async function persistResourceIntent(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  existingResource: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
  now: Date,
): Promise<ProjectResourceRow> {
  return existingResource === undefined
    ? await createProjectResourceWithExecutor(tx, createResourceInsert(context.environment.id, intent, now))
    : await updateResourceIntent(tx, existingResource, intent, now);
}

async function updateResourceIntent(
  tx: ResourceTransaction,
  existingResource: ProjectResourceRow,
  intent: ResolvedResourceIntent,
  now: Date,
): Promise<ProjectResourceRow> {
  return await updateProjectResourceIntentWithExecutor(tx, {
    commandJson: serializeResourceCommand(intent.command),
    envJson: serializeResourceEnv(intent.storedEnv),
    image: intent.image,
    operationConfigHash: intent.operationConfigHash,
    operationsJson: serializeResourceOperations(intent.operations),
    outputsJson: serializeResourceOutputs(intent.outputs),
    portsJson: serializeResourcePorts(intent.ports),
    projectResourceId: existingResource.id,
    readinessJson: serializeResourceReadiness(intent.readiness),
    runtimeDefinitionHash: intent.runtimeHash,
    updatedAt: now,
    volumesJson: serializeResourceVolumes(intent.volumes),
  });
}
