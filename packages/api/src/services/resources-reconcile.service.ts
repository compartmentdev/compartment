import {
  type CompartmentAuthoredResourceConfig,
  type NodeResourceRequest,
  type NodeResourceResponse,
  resolveCompartmentEnvironmentName,
  type CompartmentAuthoredDescriptor,
} from '@compartment/contracts';
import { reconcileNodeResource } from '@compartment/sdk';
import {
  lockProjectResourceByName,
  lockProjectResourceReconciliation,
  updateProjectResourceRuntimeWithExecutor,
} from '../queries/resources.query';
import type { ProjectResourceRow, ResourceTransaction } from '../queries/resources.query.types';
import { getApiDatabase } from '../runtime/runtime-access';
import { resolveOrCreateEnvironmentContext } from './deployment-context.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { createResourceNodeRequester } from './resource-node-requester.service';
import { assertNoUndeclaredResources } from './resources-declared-resources.validation';
import { applyResourceRestartPolicyUpdate } from './resources-restart-policy.service';
import { hasKubernetesRuntime, reconcileKubernetesResource } from './resources-kubernetes-reconcile.service';
import {
  prepareResourceEffectiveVariables,
  persistResourceIntent,
  updateResourceIntent,
} from './resources-reconcile-persistence.service';
import {
  buildNodeResourceRequest,
  resolveResourceIntent,
  type ResolvedResourceIntent,
} from './resources.service.helpers';
import {
  serializeResourceCommand,
  serializeResourceEnv,
  serializeResourceOperations,
  serializeResourceOutputs,
  serializeResourcePorts,
  serializeResourceReadiness,
  serializeResourceVolumes,
} from './resources.service.storage';
import { assertAllowedVolumeChange } from './resources-reconcile.validation';
import type {
  ReconcileResourcesInput,
  ResourceEnvironmentContext,
  ResourceListResult,
} from './resources.service.types';

export async function reconcileDeclaredResources(input: ReconcileResourcesInput): Promise<ResourceListResult> {
  const descriptor: CompartmentAuthoredDescriptor = input.descriptor;
  const environmentName: string = resolveCompartmentEnvironmentName(input.environmentName);
  const context: ResourceEnvironmentContext = await resolveOrCreateEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    descriptor.name,
    environmentName,
  );
  const resources: Record<string, CompartmentAuthoredResourceConfig> = descriptor.resources ?? {};
  await assertNoUndeclaredResources(context.environment.id, resources);

  const reconciledResources: ProjectResourceRow[] = [];
  for (const [resourceName, resource] of Object.entries(resources)) {
    reconciledResources.push(await reconcileDeclaredResource(input.actorPrincipalId, context, resourceName, resource));
  }

  return {
    ...context,
    resources: reconciledResources,
  };
}

async function reconcileDeclaredResource(
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ProjectResourceRow> {
  if (hasKubernetesRuntime(process.env)) {
    return await reconcileKubernetesResource(actorPrincipalId, context, resourceName, resource);
  }
  return await getApiDatabase().transaction(
    async (tx: ResourceTransaction): Promise<ProjectResourceRow> =>
      await reconcileNodeResourceTransaction(tx, actorPrincipalId, context, resourceName, resource),
  );
}

async function reconcileNodeResourceTransaction(
  tx: ResourceTransaction,
  actorPrincipalId: string,
  context: ResourceEnvironmentContext,
  resourceName: string,
  resource: CompartmentAuthoredResourceConfig,
): Promise<ProjectResourceRow> {
  await lockProjectResourceReconciliation(tx, context.environment.id, resourceName);
  const effectiveVariables: EffectiveVariable[] = await prepareResourceEffectiveVariables(
    tx,
    actorPrincipalId,
    context,
    resourceName,
    resource,
  );
  const intent: ResolvedResourceIntent = resolveResourceIntent(
    context.project.name,
    context.environment.name,
    resourceName,
    resource,
    effectiveVariables,
  );
  return await reconcileDeclaredResourceWithLock(tx, context, resourceName, intent);
}

async function reconcileDeclaredResourceWithLock(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  resourceName: string,
  intent: ResolvedResourceIntent,
): Promise<ProjectResourceRow> {
  const existingResource: ProjectResourceRow | undefined = await lockProjectResourceByName(
    tx,
    context.environment.id,
    resourceName,
  );
  if (existingResource !== undefined) {
    assertAllowedVolumeChange(existingResource, intent);
  }
  if (shouldSkipResourceReconcile(existingResource, intent)) {
    if (shouldUpdateRuntimeRestartPolicy(existingResource, intent)) {
      await applyResourceRestartPolicyUpdate(context, existingResource, intent.restartPolicy);
    }
    return shouldPersistIntentOnlyUpdate(existingResource, intent)
      ? await updateResourceIntent(tx, existingResource, intent, new Date(), existingResource.runtimeKind)
      : existingResource;
  }

  const response: NodeResourceResponse = await reconcilePreparedResource(context, intent);
  return await persistReconciledResource(tx, context, existingResource, intent, response);
}

async function reconcilePreparedResource(
  context: ResourceEnvironmentContext,
  intent: ResolvedResourceIntent,
): Promise<NodeResourceResponse> {
  const request: NodeResourceRequest = buildNodeResourceRequest(
    context.project.id,
    context.project.name,
    context.environment.id,
    context.environment.name,
    intent,
  );

  return await reconcileNodeResource(await createResourceNodeRequester(context), request);
}

async function persistReconciledResource(
  tx: ResourceTransaction,
  context: ResourceEnvironmentContext,
  existingResource: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
  response: NodeResourceResponse,
): Promise<ProjectResourceRow> {
  const persistedResource: ProjectResourceRow = await persistResourceIntent(
    tx,
    context,
    existingResource,
    intent,
    new Date(),
    'node',
  );

  return await persistPreparedResourceRuntime(tx, persistedResource.id, response);
}

function shouldSkipResourceReconcile(
  existingResource: ProjectResourceRow | undefined,
  intent: ResolvedResourceIntent,
): existingResource is ProjectResourceRow {
  return existingResource?.runtimeDefinitionHash === intent.runtimeHash && existingResource.status === 'running';
}

function shouldPersistIntentOnlyUpdate(existingResource: ProjectResourceRow, intent: ResolvedResourceIntent): boolean {
  return (
    existingResource.commandJson !== serializeResourceCommand(intent.command) ||
    existingResource.envJson !== serializeResourceEnv(intent.storedEnv) ||
    existingResource.image !== intent.image ||
    existingResource.operationConfigHash !== intent.operationConfigHash ||
    existingResource.operationsJson !== serializeResourceOperations(intent.operations) ||
    existingResource.outputsJson !== serializeResourceOutputs(intent.outputs) ||
    existingResource.hostname !== intent.hostname ||
    existingResource.portsJson !== serializeResourcePorts(intent.ports) ||
    existingResource.readinessJson !== serializeResourceReadiness(intent.readiness) ||
    existingResource.restartPolicy !== intent.restartPolicy ||
    existingResource.volumesJson !== serializeResourceVolumes(intent.volumes)
  );
}

function shouldUpdateRuntimeRestartPolicy(
  existingResource: ProjectResourceRow,
  intent: ResolvedResourceIntent,
): boolean {
  return existingResource.restartPolicy !== intent.restartPolicy;
}

async function persistPreparedResourceRuntime(
  tx: ResourceTransaction,
  projectResourceId: string,
  response: NodeResourceResponse,
): Promise<ProjectResourceRow> {
  return await updateProjectResourceRuntimeWithExecutor(tx, {
    containerId: response.containerId,
    projectResourceId,
    status: response.status,
    updatedAt: new Date(),
  });
}
