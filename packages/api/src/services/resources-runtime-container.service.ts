import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export function requireRunningResourceContainerId(resource: ProjectResourceRow): string {
  if (resource.containerId !== null) {
    return resource.containerId;
  }

  throw createInvalidDeployConfigError(`Resource ${resource.name} is not running.`);
}
