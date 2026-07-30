import type { ResourceClaimIdentity } from '@compartment/contracts';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { createInvalidDeployConfigError } from '../errors/api-business-error';

export function readExpectedResourceClaims(resource: ProjectResourceRow): ResourceClaimIdentity[] {
  return JSON.parse(resource.expectedClaimsJson) as ResourceClaimIdentity[];
}

export function assertExpectedResourceClaims(resourceName: string, expectedClaims: ResourceClaimIdentity[]): void {
  if (expectedClaims.length === 0) {
    throw createInvalidDeployConfigError(
      `Resource "${resourceName}" is not bootstrapped yet. Run \`compartment resource bootstrap --resource ${resourceName}\` first.`,
    );
  }
}
