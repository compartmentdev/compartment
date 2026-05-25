import { createResourceBackupNotFoundError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export function assertResourceBackupBelongsToEnvironment(resource: ProjectResourceRow, environmentId: string): void {
  if (resource.environmentId !== environmentId) {
    throw createResourceBackupNotFoundError();
  }
}
