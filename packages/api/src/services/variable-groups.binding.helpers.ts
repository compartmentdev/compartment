import type {
  CreateVariableGroupBindingInput,
  DeleteVariableGroupBindingInput,
} from '../queries/variable-groups.query.types';
import type { InsertVariableChangeEventInput } from '../queries/variables.query.types';
import type {
  LoadedVariableGroup,
  VariableGroupBindingResult,
  VariableGroupBindingTargetContext,
} from './variable-groups.service.types';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';

type VariableGroupBindingOperation = 'bind' | 'unbind';

export function buildCreateVariableGroupBindingInput(
  principalId: string,
  target: VariableGroupBindingTargetContext,
  variableGroupId: string,
  bindingId: string,
): CreateVariableGroupBindingInput {
  return {
    createdByPrincipalId: principalId,
    environmentId: target.environment.id,
    id: bindingId,
    projectServiceId: target.service?.id ?? null,
    targetResourceName: target.resourceName,
    variableGroupId,
  };
}

export function buildDeleteVariableGroupBindingInput(
  target: VariableGroupBindingTargetContext,
  variableGroupId: string,
): DeleteVariableGroupBindingInput {
  return {
    environmentId: target.environment.id,
    projectServiceId: target.service?.id ?? null,
    targetResourceName: target.resourceName,
    variableGroupId,
  };
}

export function buildVariableGroupBindingChangeEventInput(
  principalId: string,
  organizationId: string,
  variableGroup: LoadedVariableGroup,
  targetId: string,
  operation: VariableGroupBindingOperation,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: principalId,
    keyNamesJson: JSON.stringify(readVariableGroupKeyNames(variableGroup.variables)),
    operation,
    organizationId,
    targetId,
    targetType: 'binding',
  };
}

export function buildVariableGroupBindingResult(
  target: VariableGroupBindingTargetContext,
  variableGroupName: string,
): VariableGroupBindingResult {
  return {
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variableGroupName,
  };
}
