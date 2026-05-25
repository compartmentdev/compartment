import type { CompartmentAuthoredResourceConfig } from '@compartment/contracts';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { listProjectResourcesByEnvironmentId } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';

export async function assertNoUndeclaredResources(
  environmentId: string,
  resources: Record<string, CompartmentAuthoredResourceConfig>,
): Promise<void> {
  const declaredNames: Set<string> = new Set<string>(Object.keys(resources));
  const existingResources: ProjectResourceRow[] = await listProjectResourcesByEnvironmentId(environmentId);
  const undeclaredResource: ProjectResourceRow | undefined = existingResources.find(
    (resource: ProjectResourceRow): boolean => !declaredNames.has(resource.name),
  );
  if (undeclaredResource !== undefined) {
    throw createInvalidDeployConfigError(
      `Resource ${undeclaredResource.name} exists but is not declared in compartment.yml. Run compartment resource delete before removing it from YAML.`,
    );
  }
}
