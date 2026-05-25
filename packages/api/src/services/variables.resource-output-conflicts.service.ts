import type { VariableImportEntry } from '@compartment/contracts';
import { createInvalidVariableTargetError, createVariableCollisionError } from '../errors/api-business-error';
import { listEnvironmentVariableValues } from '../queries/variables.query';
import { listEnvironmentResourceOutputVariableBindings } from '../queries/variables-resource-output.query';
import type {
  EnvironmentResourceOutputVariableBindingRow,
  EnvironmentVariableValueRow,
} from '../queries/variables.query.types';
import type { ImportVariablesInput, SetVariableInput, VariableTargetContext } from './variables.service.types';

export async function assertNoDirectServiceVariableConflict(
  input: SetVariableInput,
  target: VariableTargetContext,
): Promise<void> {
  if (target.service === null) {
    return;
  }
  const serviceId: string = target.service.id;
  const variableValues: EnvironmentVariableValueRow[] = await listEnvironmentVariableValues(target.environment.id);
  const conflict: EnvironmentVariableValueRow | undefined = variableValues.find(
    (variable: EnvironmentVariableValueRow): boolean =>
      variable.projectServiceId === serviceId &&
      variable.targetResourceName === null &&
      variable.keyName === input.keyName,
  );
  if (conflict !== undefined) {
    throw createInvalidVariableTargetError(
      `Service variable "${input.keyName}" already has a literal value for service "${target.serviceName}".`,
    );
  }
}

export async function assertNoResourceOutputBindingConflict(
  input: SetVariableInput,
  target: VariableTargetContext,
): Promise<void> {
  if (target.serviceName === null) {
    return;
  }
  const conflict: EnvironmentResourceOutputVariableBindingRow | undefined = (
    await listEnvironmentResourceOutputVariableBindings(target.environment.id)
  ).find(
    (binding: EnvironmentResourceOutputVariableBindingRow): boolean =>
      binding.targetServiceName === target.serviceName && binding.keyName === input.keyName,
  );
  if (conflict !== undefined) {
    throw createInvalidVariableTargetError(
      `Service variable "${input.keyName}" already has a resource output binding for service "${target.serviceName}".`,
    );
  }
}

export async function assertNoResourceOutputImportConflicts(
  input: ImportVariablesInput,
  target: VariableTargetContext,
): Promise<void> {
  if (target.serviceName === null || target.resourceName !== null) {
    return;
  }
  const importedKeyNames: Set<string> = new Set<string>(
    input.entries.map((entry: VariableImportEntry): string => entry.keyName),
  );
  const conflictingKeyNames: string[] = (await listEnvironmentResourceOutputVariableBindings(target.environment.id))
    .filter(
      (binding: EnvironmentResourceOutputVariableBindingRow): boolean =>
        binding.targetServiceName === target.serviceName && importedKeyNames.has(binding.keyName),
    )
    .map((binding: EnvironmentResourceOutputVariableBindingRow): string => binding.keyName)
    .sort((left: string, right: string): number => left.localeCompare(right));

  if (conflictingKeyNames.length > 0) {
    throw createVariableCollisionError(
      `Variable import would overwrite resource output bindings for: ${conflictingKeyNames.join(', ')}.`,
    );
  }
}
