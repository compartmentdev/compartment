import { tailNodeResourceLogs } from '@compartment/sdk';
import { createResourceNotFoundError } from '../errors/api-business-error';
import type { NodeRow } from '../queries/node.query.types';
import { findProjectResourceByName } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { requireEnvironmentPermission } from './deployment-context.service.scope';
import { parseLogsSince } from './deployment-log-query.service';
import { readStoredResourceProductLogs } from './deployment-product-logs.service';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import { resolveResourceNode } from './resources-node.service';
import { requireRunningResourceContainerId } from './resources-runtime-container.service';
import type {
  ResourceEnvironmentContext,
  ResourceLogLineInput,
  ResourceLogsInput,
  ResourceLogsResult,
} from './resources.service.types';

interface NodeResourceLogsResult {
  lines: ResourceLogLineInput[];
}

export async function getResourceLogsForPrincipal(input: ResourceLogsInput): Promise<ResourceLogsResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  await requireEnvironmentPermission(
    input.actorPrincipalId,
    context.organization.id,
    context.environment.id,
    'deployment.logs.read',
  );
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  return { ...context, lines: await readResourceLogLines(input, context, resource), resource };
}

async function readResourceLogLines(
  input: ResourceLogsInput,
  context: ResourceEnvironmentContext,
  resource: ProjectResourceRow,
): Promise<ResourceLogLineInput[]> {
  if (resource.runtimeKind === 'kubernetes') {
    return await readStoredResourceProductLogs(
      resource.id,
      resource.name,
      parseLogsSince(input.query.since),
      input.query.tailLines,
    );
  }
  const node: NodeRow = await resolveResourceNode(context);
  const response: NodeResourceLogsResult = await tailNodeResourceLogs(createNodeRuntimeRequester(node.nodeSocketPath), {
    containerId: requireRunningResourceContainerId(resource),
    environmentName: context.environment.name,
    resourceName: resource.name,
    ...(input.query.since !== undefined ? { since: input.query.since } : {}),
    ...(input.query.tailLines !== undefined ? { tailLines: input.query.tailLines } : {}),
  });
  return response.lines;
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceByName(environmentId, resourceName);
  if (resource === undefined) {
    throw createResourceNotFoundError();
  }
  return resource;
}
