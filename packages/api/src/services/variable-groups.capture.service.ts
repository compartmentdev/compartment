import { createVariableCollisionError } from '../errors/api-business-error';
import type { EncryptedVariableValue } from '../lib/variables-crypto';
import { captureVariableGroupWithAudit } from '../queries/variable-groups.query';
import { findLoadedVariableGroup, handleDuplicateVariableGroupName } from './variable-groups.service.helpers';
import type {
  CaptureVariableGroupInput,
  CaptureVariableGroupResult,
  CapturedVariableValue,
  LoadedVariableGroup,
  VariableGroupBindingTargetContext,
} from './variable-groups.service.types';
import {
  assertCapturedVariableGroupValuesPresent,
  buildCapturedVariableGroupInput,
  createCapturedVariableGroupId,
  encryptCapturedVariableGroupValues,
  loadCapturedVariableGroupValues,
} from './variable-groups.capture.helpers';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';
import { showVariableGroupForPrincipal } from './variable-groups.read.service';
import { resolveReadVariableTarget } from './variables.target.service';

export async function captureVariableGroupForPrincipal(
  input: CaptureVariableGroupInput,
): Promise<CaptureVariableGroupResult> {
  await assertVariableGroupCaptureNameAvailable(input.organizationId, input.variableGroupName);

  const now: Date = new Date();
  const variableGroupId: string = createCapturedVariableGroupId();
  const target: VariableGroupBindingTargetContext = await resolveReadVariableTarget(input, 'variable.value.read');
  const capturedVariables: CapturedVariableValue[] = await loadCapturedVariableGroupValues(
    input,
    target,
    input.organizationId,
  );
  assertCapturedVariableGroupValuesPresent(capturedVariables, input.effective === true);

  await persistCapturedVariableGroup(
    input,
    variableGroupId,
    capturedVariables,
    encryptCapturedVariableGroupValues(capturedVariables),
    now,
  );

  return await buildCaptureVariableGroupResult(input, target, capturedVariables);
}

async function assertVariableGroupCaptureNameAvailable(
  organizationId: string,
  variableGroupName: string,
): Promise<void> {
  const variableGroup: LoadedVariableGroup | null = await findLoadedVariableGroup(organizationId, variableGroupName);
  if (variableGroup !== null) {
    throw createVariableCollisionError(`Variable group ${variableGroupName} already exists.`);
  }
}

async function persistCapturedVariableGroup(
  input: CaptureVariableGroupInput,
  variableGroupId: string,
  capturedVariables: readonly CapturedVariableValue[],
  encryptedValues: readonly EncryptedVariableValue[],
  now: Date,
): Promise<void> {
  try {
    await captureVariableGroupWithAudit(
      buildCapturedVariableGroupInput(input, variableGroupId, capturedVariables, encryptedValues, now),
    );
  } catch (error) {
    if (error instanceof Error) {
      handleDuplicateVariableGroupName(error, input.variableGroupName);
    }
    throw error;
  }
}

async function buildCaptureVariableGroupResult(
  input: CaptureVariableGroupInput,
  target: VariableGroupBindingTargetContext,
  capturedVariables: readonly CapturedVariableValue[],
): Promise<CaptureVariableGroupResult> {
  return {
    capturedKeyNames: readVariableGroupKeyNames(capturedVariables),
    environment: target.environment,
    project: target.project,
    resourceName: target.resourceName,
    serviceName: target.serviceName,
    variableGroup: (await showVariableGroupForPrincipal(input)).variableGroup,
  };
}
