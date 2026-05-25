import { createVariableCollisionError } from '../errors/api-business-error';
import { listVariableGroupBindings } from '../queries/variable-groups.query';
import {
  listEnvironmentVariableSetBindings,
  listOrganizationVariableSetEntriesForSetIds,
  listOrganizationVariableSetNamesByIds,
} from '../queries/variables.query';
import type {
  EnvironmentVariableSetBindingRow,
  OrganizationVariableSetEntryRow,
  OrganizationVariableSetNameRow,
} from '../queries/variables.query.types';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';
import type { LoadedVariableGroup, VariableGroupBindingTargetContext } from './variable-groups.service.types';

export async function assertVariableGroupBindConflictsAbsent(
  target: VariableGroupBindingTargetContext,
  variableGroup: LoadedVariableGroup,
  organizationId: string,
): Promise<void> {
  await assertVariableGroupKeyConflictsAbsent(
    target.environment.id,
    readTargetServiceId(target),
    target.resourceName,
    readVariableGroupKeyNames(variableGroup.variables),
    variableGroup.id,
    organizationId,
  );
}

export async function assertVariableGroupMutationConflictsAbsent(
  variableGroup: LoadedVariableGroup,
  candidateKeyNames: readonly string[],
  organizationId: string,
): Promise<void> {
  const bindings: EnvironmentVariableSetBindingRow[] = await listVariableGroupBindings(
    organizationId,
    variableGroup.id,
  );

  for (const binding of bindings) {
    await assertVariableGroupKeyConflictsAbsent(
      binding.environmentId,
      binding.projectServiceId,
      binding.targetResourceName,
      candidateKeyNames,
      variableGroup.id,
      organizationId,
    );
  }
}

export async function findExistingVariableGroupBinding(
  target: VariableGroupBindingTargetContext,
  variableGroupId: string,
  organizationId: string,
): Promise<EnvironmentVariableSetBindingRow | null> {
  const bindings: EnvironmentVariableSetBindingRow[] = await listEnvironmentVariableSetBindings(
    target.environment.id,
    organizationId,
  );
  const serviceId: string | null = readTargetServiceId(target);
  const resourceName: string | null = target.resourceName;

  return (
    bindings.find(
      (binding: EnvironmentVariableSetBindingRow): boolean =>
        binding.organizationVariableSetId === variableGroupId &&
        binding.projectServiceId === serviceId &&
        binding.targetResourceName === resourceName,
    ) ?? null
  );
}

async function assertVariableGroupKeyConflictsAbsent(
  environmentId: string,
  projectServiceId: string | null,
  targetResourceName: string | null,
  candidateKeyNames: readonly string[],
  variableGroupId: string,
  organizationId: string,
): Promise<void> {
  const sameScopeBindings: EnvironmentVariableSetBindingRow[] = await readSameScopeBindingsForTarget(
    environmentId,
    organizationId,
    projectServiceId,
    targetResourceName,
    variableGroupId,
  );
  if (sameScopeBindings.length === 0) {
    return;
  }
  const [existingVariables, existingNames] = await readSameScopeVariableGroupSources(sameScopeBindings, organizationId);
  const conflictingKeyNames: string[] = readConflictingKeyNames(candidateKeyNames, existingVariables);
  if (conflictingKeyNames.length === 0) {
    return;
  }
  throw createVariableCollisionError(buildVariableGroupBindConflictMessage(existingNames, conflictingKeyNames));
}

async function readSameScopeVariableGroupSources(
  sameScopeBindings: readonly EnvironmentVariableSetBindingRow[],
  organizationId: string,
): Promise<[OrganizationVariableSetEntryRow[], OrganizationVariableSetNameRow[]]> {
  const sameScopeGroupIds: string[] = sameScopeBindings.map(
    (binding: EnvironmentVariableSetBindingRow): string => binding.organizationVariableSetId,
  );

  return await Promise.all([
    listOrganizationVariableSetEntriesForSetIds(sameScopeGroupIds, organizationId),
    listOrganizationVariableSetNamesByIds(sameScopeGroupIds, organizationId),
  ]);
}

async function readSameScopeBindingsForTarget(
  environmentId: string,
  organizationId: string,
  projectServiceId: string | null,
  targetResourceName: string | null,
  variableGroupId: string,
): Promise<EnvironmentVariableSetBindingRow[]> {
  return readSameScopeBindings(
    await listEnvironmentVariableSetBindings(environmentId, organizationId),
    projectServiceId,
    targetResourceName,
    variableGroupId,
  );
}

function readSameScopeBindings(
  bindings: readonly EnvironmentVariableSetBindingRow[],
  projectServiceId: string | null,
  targetResourceName: string | null,
  variableGroupId: string,
): EnvironmentVariableSetBindingRow[] {
  return bindings.filter(
    (binding: EnvironmentVariableSetBindingRow): boolean =>
      binding.projectServiceId === projectServiceId &&
      binding.targetResourceName === targetResourceName &&
      binding.organizationVariableSetId !== variableGroupId,
  );
}

function readConflictingKeyNames(
  candidateKeyNames: readonly string[],
  existingVariables: readonly OrganizationVariableSetEntryRow[],
): string[] {
  const candidateKeyNameSet: Set<string> = new Set<string>(candidateKeyNames);

  return [
    ...new Set<string>(
      existingVariables
        .filter((variable: OrganizationVariableSetEntryRow): boolean => candidateKeyNameSet.has(variable.keyName))
        .map((variable: OrganizationVariableSetEntryRow): string => variable.keyName),
    ),
  ].sort((left: string, right: string): number => left.localeCompare(right));
}

function buildVariableGroupBindConflictMessage(
  existingNames: readonly OrganizationVariableSetNameRow[],
  conflictingKeyNames: readonly string[],
): string {
  return `Variable group bind would conflict with same-scope groups ${existingNames.map((row: OrganizationVariableSetNameRow): string => row.name).join(', ')} for keys: ${conflictingKeyNames.join(', ')}.`;
}

function readTargetServiceId(target: VariableGroupBindingTargetContext): string | null {
  return target.service === null ? null : target.service.id;
}
