import { listEnvironmentResourceOutputVariableBindings } from '../queries/variables-resource-output.query';
import type { EnvironmentResourceOutputVariableBindingRow } from '../queries/variables.query.types';
import { resolveExistingBuildTargetContext } from './deployment-context.service';
import { resolveDeploymentBuildEnv } from './deployment-build-plan.service';
import { assertDescriptorServiceConnectionBuildEnvIsRuntimeOnly } from './deployment-service-connections.service';
import type { BuildEnvResolutionOptions } from './deployment-build.types';
import type {
  DeployInputContext,
  ResolvedDescriptorService,
  ResolvedExistingBuildTargetContext,
} from './deployments.service.types';

export async function validateDescriptorBuildEnv(
  input: DeployInputContext,
  descriptorServices: readonly ResolvedDescriptorService[],
  environmentName: string,
): Promise<void> {
  for (const descriptorService of descriptorServices) {
    await validateDescriptorServiceBuildEnv(input, environmentName, descriptorService);
  }
}

async function validateDescriptorServiceBuildEnv(
  input: DeployInputContext,
  environmentName: string,
  descriptorService: ResolvedDescriptorService,
): Promise<void> {
  assertDescriptorServiceConnectionBuildEnvIsRuntimeOnly(descriptorService);
  const buildTargetContext: ResolvedExistingBuildTargetContext = await resolveExistingBuildTargetContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.descriptor.name,
    environmentName,
    descriptorService.name,
  );

  await resolveDeploymentBuildEnv(
    descriptorService.build,
    {
      environmentId: buildTargetContext.environmentId,
      organizationId: buildTargetContext.organizationId,
      serviceId: buildTargetContext.serviceId,
      serviceName: descriptorService.name,
    },
    await buildDescriptorServiceConnectionBuildEnvOptions(descriptorService, buildTargetContext),
  );
}

async function buildDescriptorServiceConnectionBuildEnvOptions(
  service: ResolvedDescriptorService,
  buildTargetContext: ResolvedExistingBuildTargetContext,
): Promise<BuildEnvResolutionOptions> {
  return {
    ignoredDescriptorResourceOutputBindingKeyNames: await listStaleDescriptorServiceConnectionBuildEnvKeyNames(
      service,
      buildTargetContext,
    ),
  };
}

async function listStaleDescriptorServiceConnectionBuildEnvKeyNames(
  service: ResolvedDescriptorService,
  buildTargetContext: ResolvedExistingBuildTargetContext,
): Promise<string[]> {
  if (service.build.env.length === 0 || buildTargetContext.environmentId === null) {
    return [];
  }

  const buildEnvKeyNames: Set<string> = new Set<string>(service.build.env);
  const desiredConnectionKeyNames: Set<string> = readDescriptorServiceConnectionKeyNames(service);
  const bindings: EnvironmentResourceOutputVariableBindingRow[] = await listEnvironmentResourceOutputVariableBindings(
    buildTargetContext.environmentId,
  );

  return bindings
    .filter((binding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      isStaleDescriptorServiceConnectionBuildEnvBinding(
        service.name,
        buildEnvKeyNames,
        desiredConnectionKeyNames,
        binding,
      ),
    )
    .map((binding: EnvironmentResourceOutputVariableBindingRow): string => binding.keyName)
    .sort((left: string, right: string): number => left.localeCompare(right));
}

function readDescriptorServiceConnectionKeyNames(service: ResolvedDescriptorService): Set<string> {
  const keyNames: Set<string> = new Set<string>();
  for (const connection of Object.values(service.connections)) {
    for (const keyName of Object.keys(connection.env)) {
      keyNames.add(keyName);
    }
  }

  return keyNames;
}

function isStaleDescriptorServiceConnectionBuildEnvBinding(
  serviceName: string,
  buildEnvKeyNames: ReadonlySet<string>,
  desiredConnectionKeyNames: ReadonlySet<string>,
  binding: EnvironmentResourceOutputVariableBindingRow,
): boolean {
  return (
    binding.source === 'descriptor' &&
    binding.targetServiceName === serviceName &&
    buildEnvKeyNames.has(binding.keyName) &&
    !desiredConnectionKeyNames.has(binding.keyName)
  );
}
