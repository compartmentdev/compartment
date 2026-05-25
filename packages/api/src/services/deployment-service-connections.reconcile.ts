import { reconcileDeclaredResources } from './resources.service';
import type { ResourceListResult } from './resources.service.types';
import type {
  DeployInputContext,
  ResolvedDescriptorService,
  ResolvedProjectContext,
} from './deployments.service.types';
import { prepareDescriptorServiceConnectionBindingPlan } from './deployment-service-connections.plan';
import { validateDescriptorServiceConnectionBindingPreflight } from './deployment-service-connections.preflight';
import { applyDescriptorServiceConnectionBindingPlan } from './deployment-service-connections.service';
import type { DescriptorServiceConnectionBindingPlan } from './deployment-service-connections.service.types';

export async function validateDeployDescriptorServiceConnectionPreflight(
  input: DeployInputContext,
  descriptorServices: readonly ResolvedDescriptorService[],
  environmentName: string,
): Promise<void> {
  await validateDescriptorServiceConnectionBindingPreflight({
    actorPrincipalId: input.actorPrincipalId,
    environmentName,
    organizationSlug: input.organizationSlug,
    projectName: input.descriptor.name,
    services: descriptorServices,
  });
}

export async function prepareDeployDescriptorServiceConnectionBindingPlan(
  actorPrincipalId: string,
  contexts: readonly ResolvedProjectContext[],
): Promise<DescriptorServiceConnectionBindingPlan> {
  return await prepareDescriptorServiceConnectionBindingPlan({
    actorPrincipalId,
    contexts,
  });
}

export async function reconcileDeclaredResourcesAndDescriptorServiceConnections(
  input: DeployInputContext,
  connectionBindingPlan: DescriptorServiceConnectionBindingPlan,
): Promise<ResourceListResult> {
  const resources: ResourceListResult = await reconcileResourcesForDeploy(input);
  await applyDescriptorServiceConnectionBindingPlan({ plan: connectionBindingPlan });

  return resources;
}

async function reconcileResourcesForDeploy(input: DeployInputContext): Promise<ResourceListResult> {
  return await reconcileDeclaredResources({
    actorPrincipalId: input.actorPrincipalId,
    descriptor: input.descriptor,
    environmentName: input.environmentName,
    organizationSlug: input.organizationSlug,
  });
}
