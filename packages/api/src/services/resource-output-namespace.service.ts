import { findEnvironmentById } from '../queries/access-scope.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export async function resolveResourceOutputNamespaceId(
  resource: ProjectResourceRow,
  environmentId: string,
): Promise<string> {
  if (resource.runtimeKind === 'node') {
    return environmentId;
  }
  const environment: { projectId: string } | undefined = await findEnvironmentById(environmentId);
  if (environment === undefined) {
    throw new Error(`Environment ${environmentId} does not exist.`);
  }
  return environment.projectId;
}
