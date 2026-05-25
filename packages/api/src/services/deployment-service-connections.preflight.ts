import { resolveExistingBuildTargetContext } from './deployment-context.service';
import type { ResolvedDescriptorService, ResolvedExistingBuildTargetContext } from './deployments.service.types';
import {
  assertDescriptorServiceConnectionBindingCanUpsert,
  buildDescriptorServiceConnectionBindingsForTarget,
  loadDescriptorServiceConnectionContextRows,
  type DescriptorServiceConnectionContextRows,
} from './deployment-service-connections.plan';
import type {
  DescriptorServiceConnectionBindingInput,
  ValidateDescriptorServiceConnectionBindingPreflightInput,
} from './deployment-service-connections.service.types';

interface ExistingDescriptorServiceConnectionTarget {
  environmentId: string;
  organizationId: string;
  serviceId: string;
}

export async function validateDescriptorServiceConnectionBindingPreflight(
  input: ValidateDescriptorServiceConnectionBindingPreflightInput,
): Promise<void> {
  for (const service of input.services) {
    await validateDescriptorServiceConnectionBindingPreflightForService(input, service);
  }
}

async function validateDescriptorServiceConnectionBindingPreflightForService(
  input: ValidateDescriptorServiceConnectionBindingPreflightInput,
  service: ResolvedDescriptorService,
): Promise<void> {
  const target: ExistingDescriptorServiceConnectionTarget | null = await readExistingDescriptorServiceConnectionTarget(
    input,
    service.name,
  );
  if (target === null) {
    return;
  }

  const rows: DescriptorServiceConnectionContextRows = await loadDescriptorServiceConnectionContextRows(
    target.environmentId,
  );
  for (const binding of buildDescriptorServiceConnectionPreflightBindings(service, target)) {
    assertDescriptorServiceConnectionBindingCanUpsert(binding, rows);
  }
}

async function readExistingDescriptorServiceConnectionTarget(
  input: ValidateDescriptorServiceConnectionBindingPreflightInput,
  serviceName: string,
): Promise<ExistingDescriptorServiceConnectionTarget | null> {
  const buildTargetContext: ResolvedExistingBuildTargetContext = await resolveExistingBuildTargetContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.projectName,
    input.environmentName,
    serviceName,
  );
  if (!hasExistingDescriptorServiceConnectionTarget(buildTargetContext)) {
    return null;
  }

  return buildTargetContext;
}

function buildDescriptorServiceConnectionPreflightBindings(
  service: ResolvedDescriptorService,
  target: ExistingDescriptorServiceConnectionTarget,
): DescriptorServiceConnectionBindingInput[] {
  return buildDescriptorServiceConnectionBindingsForTarget({
    environmentId: target.environmentId,
    organizationId: target.organizationId,
    service,
    targetServiceId: target.serviceId,
  });
}

function hasExistingDescriptorServiceConnectionTarget(
  context: ResolvedExistingBuildTargetContext,
): context is ExistingDescriptorServiceConnectionTarget {
  return context.environmentId !== null && context.organizationId !== null && context.serviceId !== null;
}
