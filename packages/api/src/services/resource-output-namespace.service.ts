import { findEnvironmentById } from '../queries/access-scope.query';

export async function resolveResourceOutputNamespaceId(environmentId: string): Promise<string> {
  const environment: { projectId: string } | undefined = await findEnvironmentById(environmentId);
  if (environment === undefined) {
    throw new Error(`Environment ${environmentId} does not exist.`);
  }
  return environment.projectId;
}
