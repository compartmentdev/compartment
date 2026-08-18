import type { ResourceVolumeSummary } from '@compartment/contracts';
import { createResourceConflictError, createResourceNotFoundError } from '../errors/api-business-error';
import { findProjectResourceByName, listProjectResourcesByEnvironmentId } from '../queries/resources.query';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { resolveResourceEnvironmentContext } from './resource-environment-context.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import { auditResourceOutputReveal, requireResourceOutputRevealPermission } from './resource-output-disclosure.service';
import { resolveResourceOutputForLookup } from './resource-output-lookup.service';
import { listResolvedResourceOutputSummaries } from './resource-output-resolution.service';
import { withResourceOperationLocks } from './resource-operation-lock.service';
import { loadResourceEffectiveVariables } from './resources-effective-variables.service';
import {
  bootstrapKubernetesResource,
  deleteKubernetesResource,
  reconcileKubernetesResourceReplicas,
} from './resources-kubernetes-reconcile.service';
import { parseResourceVolumes } from './resources.service.storage';
import type {
  ResourceActionInput,
  ResourceDeleteInput,
  ResourceDeleteResult,
  ResourceEnvironmentContext,
  ResourceListInput,
  ResourceListResult,
  ResourceLookupResult,
  ResourceOutputInput,
  ResourceOutputListResult,
  ResourceOutputResult,
  ResourceOutputSummaryInput,
} from './resources.service.types';

export { reconcileDeclaredResources } from './resources-reconcile.service';

export async function listResourcesForPrincipal(input: ResourceListInput): Promise<ResourceListResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  return {
    ...context,
    resources: await listProjectResourcesByEnvironmentId(context.environment.id),
  };
}

export async function listResourceOutputsForPrincipal(input: ResourceActionInput): Promise<ResourceOutputListResult> {
  const lookup: ResourceLookupResult = await getResourceForPrincipal(input);
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    lookup.environment.id,
    lookup.organization.id,
    lookup.resource.name,
  );

  return {
    ...lookup,
    outputs: listResolvedResourceOutputSummaries(
      {
        environmentName: lookup.environment.name,
        namespaceId: lookup.project.id,
        projectName: lookup.project.name,
        resource: lookup.resource,
      },
      effectiveVariables,
      false,
    ),
  };
}

export async function getResourceOutputForPrincipal(input: ResourceOutputInput): Promise<ResourceOutputResult> {
  const lookup: ResourceLookupResult = await getResourceForPrincipal(input);
  const reveal: boolean = input.query.reveal === true;
  await requireResourceOutputRevealPermission(input, lookup, reveal);
  const effectiveVariables: EffectiveVariable[] = await loadResourceEffectiveVariables(
    lookup.environment.id,
    lookup.organization.id,
    lookup.resource.name,
  );
  const output: ResourceOutputSummaryInput = resolveResourceOutputForLookup(input, lookup, effectiveVariables, reveal);
  await auditResourceOutputReveal(input, lookup, output, reveal);
  return { ...lookup, output };
}

export async function getResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'deployment.create');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  return { ...context, resource };
}

export async function startResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'project.lifecycle.write');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  return { ...context, resource: await reconcileKubernetesResourceReplicas(context, resource, 1) };
}

export async function bootstrapResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'project.lifecycle.write');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  if (resource.expectedClaimsJson !== '[]') {
    throw createResourceConflictError(`Resource "${resource.name}" is already bootstrapped.`);
  }
  await bootstrapKubernetesResource(context, resource);
  return { ...context, resource };
}

export async function stopResourceForPrincipal(input: ResourceActionInput): Promise<ResourceLookupResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'project.lifecycle.write');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  const stopped: ProjectResourceRow = await withResourceOperationLocks(
    [resource.id],
    async (): Promise<ProjectResourceRow> => {
      const current: ProjectResourceRow = await resolveRequiredResource(
        context.environment.id,
        input.query.resourceName,
      );
      return await reconcileKubernetesResourceReplicas(context, current, 0);
    },
  );
  return { ...context, resource: stopped };
}

export async function deleteResourceForPrincipal(input: ResourceDeleteInput): Promise<ResourceDeleteResult> {
  const context: ResourceEnvironmentContext = await resolveResourceEnvironmentContext(input, 'project.delete');
  const resource: ProjectResourceRow = await resolveRequiredResource(context.environment.id, input.query.resourceName);
  const volumes: ResourceVolumeSummary[] = parseResourceVolumes(resource);
  const deletedData: boolean = await deleteKubernetesResource(context, resource, input.body.deleteData === true);
  return {
    ...context,
    resource,
    retainedVolumes: deletedData ? [] : volumes.map((volume: ResourceVolumeSummary): string => volume.name),
  };
}

async function resolveRequiredResource(environmentId: string, resourceName: string): Promise<ProjectResourceRow> {
  return (await findProjectResourceByName(environmentId, resourceName)) ?? failResourceLookup();
}

function failResourceLookup(): never {
  throw createResourceNotFoundError();
}
