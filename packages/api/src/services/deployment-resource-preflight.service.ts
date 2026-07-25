import type { ResourceClaimIdentity } from '@compartment/contracts';
import { createResourceNotBootstrappedError, createResourceNotRunningError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { ResolvedDescriptorService } from './deployments.service.types';

export function assertDeployReleaseResourcesReady(
  descriptorServices: readonly ResolvedDescriptorService[],
  resources: readonly ProjectResourceRow[],
): void {
  const resourcesByName: Map<string, ProjectResourceRow> = new Map<string, ProjectResourceRow>(
    resources.map((resource: ProjectResourceRow): [string, ProjectResourceRow] => [resource.name, resource]),
  );

  for (const resourceName of listDependentResourceNames(descriptorServices)) {
    const resource: ProjectResourceRow | undefined = resourcesByName.get(resourceName);
    if (resource === undefined) {
      throw new Error(`Dependent resource "${resourceName}" was not reconciled before deployment submission.`);
    }
    if (readExpectedResourceClaims(resource).length === 0) {
      throw createResourceNotBootstrappedError(resourceName);
    }
    if (resource.status !== 'running') {
      throw createResourceNotRunningError(resourceName);
    }
  }
}

function listDependentResourceNames(descriptorServices: readonly ResolvedDescriptorService[]): string[] {
  const resourceNames: Set<string> = new Set<string>();
  for (const service of descriptorServices) {
    if (service.release === null) {
      continue;
    }
    for (const resourceName of Object.keys(service.connections)) {
      resourceNames.add(resourceName);
    }
  }
  return [...resourceNames].sort((left: string, right: string): number => left.localeCompare(right));
}

function readExpectedResourceClaims(resource: ProjectResourceRow): ResourceClaimIdentity[] {
  return JSON.parse(resource.expectedClaimsJson) as ResourceClaimIdentity[];
}
