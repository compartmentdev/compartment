import { createId } from '../lib/tokens';
import {
  createVariableGroupBindingWithAudit,
  deleteVariableGroupBindingWithAudit,
} from '../queries/variable-groups.query';
import type { EnvironmentVariableSetBindingRow } from '../queries/variables.query.types';
import {
  assertVariableGroupBindConflictsAbsent,
  findExistingVariableGroupBinding,
} from './variable-groups.collision.service';
import { loadVariableGroup } from './variable-groups.service.helpers';
import type {
  LoadedVariableGroup,
  VariableGroupBindingInput,
  VariableGroupBindingResult,
  VariableGroupBindingTargetContext,
} from './variable-groups.service.types';
import {
  buildVariableGroupBindingChangeEventInput,
  buildCreateVariableGroupBindingInput,
  buildDeleteVariableGroupBindingInput,
  buildVariableGroupBindingResult,
} from './variable-groups.binding.helpers';
import { resolveReadVariableTarget, resolveWriteVariableTarget } from './variables.target.service';

export async function bindVariableGroupForPrincipal(
  input: VariableGroupBindingInput,
): Promise<VariableGroupBindingResult> {
  const variableGroup: LoadedVariableGroup = await loadVariableGroup(input.organizationId, input.variableGroupName);
  const target: VariableGroupBindingTargetContext = await resolveWriteVariableTarget(
    input,
    new Date(),
    'variable.write',
  );
  const existingBinding: EnvironmentVariableSetBindingRow | null = await findExistingVariableGroupBinding(
    target,
    variableGroup.id,
    input.organizationId,
  );
  if (existingBinding !== null) {
    return buildVariableGroupBindingResult(target, variableGroup.name);
  }
  await assertVariableGroupBindConflictsAbsent(target, variableGroup, input.organizationId);
  await createVariableGroupBindingRecord(input, target, variableGroup);

  return buildVariableGroupBindingResult(target, variableGroup.name);
}

export async function unbindVariableGroupForPrincipal(
  input: VariableGroupBindingInput,
): Promise<VariableGroupBindingResult> {
  const variableGroup: LoadedVariableGroup = await loadVariableGroup(input.organizationId, input.variableGroupName);
  const target: VariableGroupBindingTargetContext = await resolveReadVariableTarget(input, 'variable.write');
  const existingBinding: EnvironmentVariableSetBindingRow | null = await findExistingVariableGroupBinding(
    target,
    variableGroup.id,
    input.organizationId,
  );
  if (existingBinding === null) {
    return buildVariableGroupBindingResult(target, variableGroup.name);
  }

  await deleteVariableGroupBindingWithAudit(
    buildDeleteVariableGroupBindingInput(target, variableGroup.id),
    buildVariableGroupBindingChangeEventInput(input.principalId, input.organizationId, variableGroup, '', 'unbind'),
  );

  return buildVariableGroupBindingResult(target, variableGroup.name);
}

async function createVariableGroupBindingRecord(
  input: VariableGroupBindingInput,
  target: VariableGroupBindingTargetContext,
  variableGroup: LoadedVariableGroup,
): Promise<void> {
  const bindingId: string = createId('vgb');

  await createVariableGroupBindingWithAudit(
    buildCreateVariableGroupBindingInput(input.principalId, target, variableGroup.id, bindingId),
    buildVariableGroupBindingChangeEventInput(
      input.principalId,
      input.organizationId,
      variableGroup,
      bindingId,
      'bind',
    ),
  );
}
