import { createResourceNotFoundError } from '../errors/api-business-error';
import { findProjectResourceByName } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { requireEnvironmentPermission } from './deployment-context.service.scope';
import { parseLogsSince } from './deployment-log-query.service';
import { readStoredResourceProductLogs } from './deployment-product-logs.service';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import type {
  ResourceEnvironmentContext,
  ResourceLogLineInput,
  ResourceLogsInput,
  ResourceLogsResult,
} from './resources.service.types';

export async function getResourceLogsForPrincipal(input: ResourceLogsInput): Promise<ResourceLogsResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  await requireEnvironmentPermission(
    input.actorPrincipalId,
    context.organization.id,
    context.environment.id,
    'deployment.logs.read',
  );
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  const lines: ResourceLogLineInput[] = await readStoredResourceProductLogs(
    resource.id,
    resource.name,
    parseLogsSince(input.query.since),
    input.query.tailLines,
  );
  return { ...context, lines, resource };
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  const resource: ProjectResourceRow | undefined = await findProjectResourceByName(environmentId, resourceName);
  if (resource === undefined) {
    throw createResourceNotFoundError();
  }
  return resource;
}
