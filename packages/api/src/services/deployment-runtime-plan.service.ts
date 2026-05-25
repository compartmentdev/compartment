import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import type { RuntimeEnvMap } from './deployment-runtime.types';

export async function buildDeploymentRuntimeEnv(
  environmentId: string,
  organizationId: string,
  projectServiceId: string,
  environmentName: string,
  projectName: string,
  serviceName: string,
): Promise<RuntimeEnvMap> {
  const effectiveVariables: EffectiveVariable[] = await loadEffectiveVariables({
    environmentId,
    environmentName,
    organizationId,
    projectName,
    targetResourceName: null,
    targetServiceId: projectServiceId,
    targetServiceName: serviceName,
    targetType: 'service',
  });

  return {
    ...Object.fromEntries(
      effectiveVariables.map((variable: EffectiveVariable): [string, string] => [variable.keyName, variable.value]),
    ),
    ...buildCompartmentRuntimeMetadata(environmentName, projectName, serviceName),
  };
}

function buildCompartmentRuntimeMetadata(
  environmentName: string,
  projectName: string,
  serviceName: string,
): RuntimeEnvMap {
  return {
    COMPARTMENT_ENVIRONMENT: environmentName,
    COMPARTMENT_PROJECT: projectName,
    COMPARTMENT_SERVICE: serviceName,
  };
}
