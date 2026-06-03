import type { RuntimeNetworkIntent } from '@compartment/contracts';
import { loadEffectiveVariables } from './effective-variables.service';
import type { EffectiveVariable } from './effective-variables.service.types';
import type { RuntimeEnvMap } from './deployment-runtime.types';

export interface DeploymentRuntimePlan {
  runtimeEnv: RuntimeEnvMap;
  runtimeNetwork: RuntimeNetworkIntent;
}

export async function buildDeploymentRuntimePlan(
  environmentId: string,
  organizationId: string,
  projectServiceId: string,
  environmentName: string,
  projectName: string,
  serviceName: string,
): Promise<DeploymentRuntimePlan> {
  const effectiveVariables: EffectiveVariable[] = await loadServiceEffectiveVariables(
    environmentId,
    organizationId,
    projectServiceId,
    environmentName,
    projectName,
    serviceName,
  );

  return {
    runtimeEnv: buildRuntimeEnv(effectiveVariables, environmentName, projectName, serviceName),
    runtimeNetwork: buildRuntimeNetworkIntent(effectiveVariables),
  };
}

function buildRuntimeEnv(
  effectiveVariables: readonly EffectiveVariable[],
  environmentName: string,
  projectName: string,
  serviceName: string,
): RuntimeEnvMap {
  return {
    ...Object.fromEntries(
      effectiveVariables.map((variable: EffectiveVariable): [string, string] => [variable.keyName, variable.value]),
    ),
    ...buildCompartmentRuntimeMetadata(environmentName, projectName, serviceName),
  };
}

async function loadServiceEffectiveVariables(
  environmentId: string,
  organizationId: string,
  projectServiceId: string,
  environmentName: string,
  projectName: string,
  serviceName: string,
): Promise<EffectiveVariable[]> {
  return await loadEffectiveVariables({
    environmentId,
    environmentName,
    organizationId,
    projectName,
    targetResourceName: null,
    targetServiceId: projectServiceId,
    targetServiceName: serviceName,
    targetType: 'service',
  });
}

function buildRuntimeNetworkIntent(effectiveVariables: readonly EffectiveVariable[]): RuntimeNetworkIntent {
  return {
    requiresResourceNetwork: effectiveVariables.some(
      (variable: EffectiveVariable): boolean => variable.sourceType === 'resource_output',
    ),
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
