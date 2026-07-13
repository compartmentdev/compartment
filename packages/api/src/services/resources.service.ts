import {
  type PermissionKey,
  type NodeResourceRequest,
  type NodeResourceLogsResponse,
  type NodeResourceResponse,
  type ResourceVolumeSummary,
} from '@compartment/contracts';
import { deleteNodeResource, startNodeResource, stopNodeResource, tailNodeResourceLogs } from '@compartment/sdk';
import { createResourceNotFoundError } from '../errors/api-business-error';
import type { NodeRow } from '../queries/node.query.types';
import {
  deleteProjectResource,
  findProjectResourceByName,
  listProjectResourcesByEnvironmentId,
  updateProjectResourceRuntime,
} from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { auditResourceOutputReveal, requireResourceOutputRevealPermission } from './resource-output-disclosure.service';
import { resolveResourceOutputForLookup } from './resource-output-lookup.service';
import { listResolvedResourceOutputSummaries } from './resource-output-resolution.service';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import { resolveResourceNode } from './resources-node.service';
import { bootstrapKubernetesResource } from './resources-kubernetes-reconcile.service';
import { requireRunningResourceContainerId } from './resources-runtime-container.service';
import { resolveStoredResourceIntent } from './resources-stored-intent.service';
import { buildNodeResourceRequest, type ResolvedResourceIntent } from './resources.service.helpers';
import { parseResourceVolumes } from './resources.service.storage';
import type {
  ResourceActionInput,
  ResourceDeleteInput,
  ResourceEnvironmentContext,
  ResourceListInput,
  ResourceListResult,
  ResourceLogsInput,
  ResourceLogsResult,
  ResourceLookupResult,
  ResourceOutputInput,
  ResourceOutputListResult,
  ResourceOutputResult,
  ResourceOutputSummaryInput,
} from './resources.service.types';
import { requireEnvironmentPermission } from './deployment-context.service.scope';

export { reconcileDeclaredResources } from './resources-reconcile.service';

export async function listResourcesForPrincipal(input: ResourceListInput): Promise<ResourceListResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');

  return {
    ...context,
    resources: await listProjectResourcesByEnvironmentId(context.environment.id),
  };
}

export async function listResourceOutputsForPrincipal(input: ResourceActionInput): Promise<ResourceOutputListResult> {
  const lookup: ResourceLookupResult = await getResourceForPrincipal(input);
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    lookup.environment.id,
    lookup.organization.id,
    lookup.resource.name,
  );

  return {
    ...lookup,
    outputs: listResolvedResourceOutputSummaries(
      {
        environmentName: lookup.environment.name,
        namespaceId: lookup.project.id,
        projectName: lookup.project.name,
        resource: lookup.resource,
      },
      effectiveVariables,
      false,
    ),
  };
}

export async function getResourceOutputForPrincipal(input: ResourceOutputInput): Promise<ResourceOutputResult> {
  const lookup: ResourceLookupResult = await getResourceForPrincipal(input);
  const reveal: boolean = input.query.reveal === true;
  await requireResourceOutputRevealPermission(input, lookup, reveal);
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    lookup.environment.id,
    lookup.organization.id,
    lookup.resource.name,
  );

  const output: ResourceOutputSummaryInput = resolveResourceOutputForLookup(input, lookup, effectiveVariables, reveal);
  await auditResourceOutputReveal(input, lookup, output, reveal);

  return {
    ...lookup,
    output,
  };
}

export async function getResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);

  return {
    ...context,
    resource,
  };
}

export async function startResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  assertNodeResourceOperation(resource, 'start');
  const node: NodeRow = await resolveResourceNode(context);
  const response: NodeResourceResponse = await startPreparedResource(context, resource, node);

  return {
    ...context,
    resource: await persistResourceRuntime(resource.id, response),
  };
}

export async function bootstrapResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  if (resource.runtimeKind !== 'kubernetes') {
    throw new Error('Resource bootstrap is only available for Kubernetes resources.');
  }
  if (resource.expectedClaimsJson !== '[]') {
    throw new Error(`Resource ${resource.name} is already bootstrapped.`);
  }
  await bootstrapKubernetesResource(context, resource);
  return { ...context, resource };
}

async function startPreparedResource(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  node: NodeRow,
): Promise<NodeResourceResponse> {
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    context.environment.id,
    context.organization.id,
    resource.name,
  );

  return await startNodeResource(
    createNodeRuntimeRequester(node.nodeSocketPath),
    buildStoredResourceStartRequest(context, resource, effectiveVariables),
  );
}

function buildStoredResourceStartRequest(
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
  effectiveVariables: EffectiveVariable[],
): NodeResourceRequest {
  const intent: ResolvedResourceIntent = resolveStoredResourceIntent(resource, effectiveVariables);

  return buildNodeResourceRequest(
    context.project.id,
    context.project.name,
    context.environment.id,
    context.environment.name,
    intent,
  );
}

export async function stopResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  assertNodeResourceOperation(resource, 'stop');
  const node: NodeRow = await resolveResourceNode(context);
  const response: NodeResourceResponse = await stopNodeResource(createNodeRuntimeRequester(node.nodeSocketPath), {
    containerId: requireRunningResourceContainerId(resource),
    environmentName: context.environment.name,
    projectName: context.project.name,
    resourceName: resource.name,
    volumes: parseResourceVolumes(resource),
  });

  return {
    ...context,
    resource: await persistResourceRuntime(resource.id, response),
  };
}

export async function deleteResourceForPrincipal(input: ResourceDeleteInput): Promise<string[]> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input);
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  assertNodeResourceOperation(resource, 'delete');
  const volumes: ResourceVolumeSummary[] = parseResourceVolumes(resource);
  const node: NodeRow = await resolveResourceNode(context);
  await deleteNodeResource(createNodeRuntimeRequester(node.nodeSocketPath), {
    containerId: resource.containerId,
    deleteData: input.body.deleteData,
    environmentName: context.environment.name,
    projectName: context.project.name,
    resourceName: resource.name,
    volumes,
  });
  await deleteProjectResource(resource.id);

  return input.body.deleteData === true ? [] : volumes.map((volume: ResourceVolumeSummary): string => volume.name);
}

export async function getResourceLogsForPrincipal(input: ResourceLogsInput): Promise<ResourceLogsResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  await requireResourceEnvironmentPermission(input.actorPrincipalId, context, 'deployment.logs.read');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  assertNodeResourceOperation(resource, 'logs');
  const node: NodeRow = await resolveResourceNode(context);
  const response: NodeResourceLogsResponse = await tailNodeResourceLogs(
    createNodeRuntimeRequester(node.nodeSocketPath),
    {
      containerId: requireRunningResourceContainerId(resource),
      environmentName: context.environment.name,
      resourceName: resource.name,
      ...(input.query.since !== undefined ? { since: input.query.since } : {}),
      ...(input.query.tailLines !== undefined ? { tailLines: input.query.tailLines } : {}),
    },
  );

  return {
    ...context,
    lines: response.lines,
    resource,
  };
}

async function requireResourceEnvironmentPermission(
  principalId: string,
  context: ResourceEnvironmentContext,
  permission: PermissionKey,
): Promise<void> {
  await requireEnvironmentPermission(principalId, context.organization.id, context.environment.id, permission);
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  return (await findProjectResourceByName(environmentId, resourceName)) ?? failResourceLookup();
}

function assertNodeResourceOperation(resource: ProjectResourceRow, operation: string): void {
  if (resource.runtimeKind === 'kubernetes') {
    throw new Error(`Resource ${operation} is not implemented for Kubernetes resources.`);
  }
}

async function persistResourceRuntime(
  projectResourceId: string,
  response: NodeResourceResponse,
): Promise<ProjectResourceRow> {
  return await updateProjectResourceRuntime({
    containerId: response.containerId,
    projectResourceId,
    status: response.status,
    updatedAt: new Date(),
  });
}

function failResourceLookup(): never {
  throw createResourceNotFoundError();
}
