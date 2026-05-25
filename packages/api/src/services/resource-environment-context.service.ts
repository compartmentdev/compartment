import { type PermissionKey, resolveCompartmentEnvironmentName } from '@compartment/contracts';
import { resolveExistingEnvironmentContext } from './deployment-context.service';
import type { ResourceEnvironmentContext } from './resources.service.types';

interface ResolveResourceEnvironmentContextInput {
  actorPrincipalId: string;
  organizationSlug: string;
  query: ResourceEnvironmentContextQuery;
}

interface ResourceEnvironmentContextQuery {
  environmentName?: string | undefined;
  projectName: string;
}

export async function resolveResourceEnvironmentContext(
  input: ResolveResourceEnvironmentContextInput,
  permission?: PermissionKey,
): Promise<ResourceEnvironmentContext> {
  return await resolveExistingEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.query.projectName,
    resolveCompartmentEnvironmentName(input.query.environmentName),
    permission,
  );
}
