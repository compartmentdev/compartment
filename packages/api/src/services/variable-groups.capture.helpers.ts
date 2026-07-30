import type { VariableSensitivity } from '@compartment/contracts';
import { createVariableCollisionError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { encryptTenantVariableValueForStorage, type EncryptedVariableValue } from '../lib/variables-crypto';
import type {
  CaptureVariableGroupInput as CaptureVariableGroupQueryInput,
  CreateVariableGroupInput as CreateVariableGroupQueryInput,
  UpsertVariableGroupEntryInput,
} from '../queries/variable-groups.query.types';
import type { InsertVariableChangeEventInput } from '../queries/variables.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  buildVariableGroupFingerprintsJson,
  loadDirectCapturedVariables,
  loadEffectiveCapturedVariables,
} from './variable-groups.service.helpers';
import { readVariableGroupKeyNames } from './variable-groups.key-names.helpers';
import type {
  CaptureVariableGroupInput,
  CapturedVariableValue,
  VariableGroupBindingTargetContext,
} from './variable-groups.service.types';
import { buildVariableGroupEntryInput } from './variable-groups.write.helpers';

export function createCapturedVariableGroupId(): string {
  return createId('vset');
}

export async function loadCapturedVariableGroupValues(
  input: CaptureVariableGroupInput,
  target: VariableGroupBindingTargetContext,
  organizationId: string,
): Promise<CapturedVariableValue[]> {
  return input.effective === true
    ? await loadEffectiveCapturedVariables(target, organizationId)
    : await loadDirectCapturedVariables(target);
}

export function assertCapturedVariableGroupValuesPresent(
  capturedVariables: readonly CapturedVariableValue[],
  effective: boolean,
): void {
  if (capturedVariables.length === 0) {
    throw createVariableCollisionError(
      effective
        ? 'No effective variables were found on the resolved target.'
        : 'No direct variables were found on the resolved target. Retry with --effective to capture winner values.',
    );
  }
}

export function encryptCapturedVariableGroupValues(
  variables: readonly CapturedVariableValue[],
): EncryptedVariableValue[] {
  return variables.map(
    (variable: CapturedVariableValue): EncryptedVariableValue =>
      encryptTenantVariableValueForStorage(
        variable.value,
        getApiConfig().tenantSecretsKek,
        getApiConfig().variablesMasterKey,
      ),
  );
}

export function buildCapturedVariableGroupInput(
  input: CaptureVariableGroupInput,
  variableGroupId: string,
  capturedVariables: readonly CapturedVariableValue[],
  encryptedValues: readonly EncryptedVariableValue[],
  now: Date,
): CaptureVariableGroupQueryInput {
  return {
    changeEvent: buildCapturedVariableGroupChangeEventInput(input, variableGroupId, capturedVariables, encryptedValues),
    group: buildCapturedVariableGroupRecord(input, variableGroupId, now),
    values: buildCapturedVariableGroupEntries(
      input.principalId,
      variableGroupId,
      capturedVariables,
      encryptedValues,
      now,
    ),
  };
}

function buildCapturedVariableGroupChangeEventInput(
  input: CaptureVariableGroupInput,
  variableGroupId: string,
  capturedVariables: readonly CapturedVariableValue[],
  encryptedValues: readonly EncryptedVariableValue[],
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    fingerprintsJson: buildVariableGroupFingerprintsJson(encryptedValues),
    keyNamesJson: JSON.stringify(readVariableGroupKeyNames(capturedVariables)),
    operation: 'capture',
    organizationId: input.organizationId,
    sensitivityJson: JSON.stringify(
      capturedVariables.map((variable: CapturedVariableValue): VariableSensitivity => variable.sensitivity),
    ),
    targetId: variableGroupId,
    targetType: 'variable_set',
  };
}

function buildCapturedVariableGroupEntries(
  principalId: string,
  variableGroupId: string,
  capturedVariables: readonly CapturedVariableValue[],
  encryptedValues: readonly EncryptedVariableValue[],
  now: Date,
): UpsertVariableGroupEntryInput[] {
  return capturedVariables.map(
    (variable: CapturedVariableValue, index: number): UpsertVariableGroupEntryInput =>
      buildVariableGroupEntryInput(
        principalId,
        variableGroupId,
        variable.keyName,
        variable.sensitivity,
        encryptedValues[index]!,
        now,
      ),
  );
}

function buildCapturedVariableGroupRecord(
  input: CaptureVariableGroupInput,
  variableGroupId: string,
  now: Date,
): CreateVariableGroupQueryInput {
  return {
    createdByPrincipalId: input.principalId,
    description: null,
    id: variableGroupId,
    name: input.variableGroupName,
    organizationId: input.organizationId,
    updatedAt: now,
  };
}
