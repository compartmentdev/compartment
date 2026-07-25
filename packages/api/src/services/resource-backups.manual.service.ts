import { createResourceConflictError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export function assertResourceRunningForManualBackup(resource: ProjectResourceRow): void {
  if (resource.status === 'running') {
    return;
  }
  throw createResourceConflictError(
    `Resource "${resource.name}" is ${resource.status}. Start it with \`compartment resource start --resource ${resource.name}\` before creating a backup.`,
  );
}
