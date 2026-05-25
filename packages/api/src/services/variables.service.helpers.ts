import { resolveCompartmentEnvironmentName, type VariableSensitivity } from '@compartment/contracts';
import { createServiceNotFoundError } from '../errors/api-business-error';
import type { LoadEffectiveVariablesInput } from './effective-variables.service.types';
import { readVariableTargetType } from './variable-target-type.helpers';
import type { VariableTargetContext, VariableTargetInput } from './variables.service.types';

interface VariableSensitivityInput {
  sensitivity?: VariableSensitivity | undefined;
}

export function readEnvironmentName(input: VariableTargetInput): string {
  return resolveCompartmentEnvironmentName(input.environmentName);
}

export function readVariableSensitivity(input: VariableSensitivityInput): VariableSensitivity {
  return input.sensitivity ?? 'plain';
}

export function buildLoadEffectiveVariablesInput(target: VariableTargetContext): LoadEffectiveVariablesInput {
  return {
    environmentId: target.environment.id,
    environmentName: target.environment.name,
    organizationId: target.organization.id,
    projectName: target.project.name,
    targetResourceName: target.resourceName,
    targetServiceId: target.service?.id ?? null,
    targetServiceName: target.serviceName,
    targetType: readVariableTargetType({
      resourceName: target.resourceName,
      serviceName: target.serviceName,
    }),
  };
}

export function failMissingServiceName(): never {
  throw createServiceNotFoundError();
}
