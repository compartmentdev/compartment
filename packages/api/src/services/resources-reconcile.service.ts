import {
  resolveCompartmentEnvironmentName,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredResourceConfig,
} from '@compartment/contracts';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { resolveOrCreateEnvironmentContext } from './deployment-context.service';
import { assertNoUndeclaredResources } from './resources-declared-resources.validation';
import { reconcileKubernetesResource } from './resources-kubernetes-reconcile.service';
import type {
  ReconcileResourcesInput,
  ResourceEnvironmentContext,
  ResourceListResult,
} from './resources.service.types';

export async function reconcileDeclaredResources(input: ReconcileResourcesInput): Promise<ResourceListResult> {
  const descriptor: CompartmentAuthoredDescriptor = input.descriptor;
  const environmentName: string = resolveCompartmentEnvironmentName(input.environmentName);
  const context: ResourceEnvironmentContext = await resolveOrCreateEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    descriptor.name,
    environmentName,
  );
  const resources: Record<string, CompartmentAuthoredResourceConfig> = descriptor.resources ?? {};
  await assertNoUndeclaredResources(context.environment.id, resources);

  const reconciledResources: ProjectResourceRow[] = [];
  for (const [resourceName, resource] of Object.entries(resources)) {
    reconciledResources.push(
      await reconcileKubernetesResource(input.actorPrincipalId, context, resourceName, resource),
    );
  }

  return {
    ...context,
    resources: reconciledResources,
  };
}
