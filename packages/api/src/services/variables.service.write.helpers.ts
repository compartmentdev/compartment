import type { VariableImportEntry, VariableSensitivity } from '@compartment/contracts';
import type { EncryptedVariableValue } from '../lib/variables-crypto';
import type {
  InsertVariableChangeEventInput,
  UpsertEnvironmentVariableValueInput,
} from '../queries/variables.query.types';
import type {
  ImportVariablesInput,
  RemoveVariableInput,
  SetVariableInput,
  ShowVariableInput,
  VariableTargetContext,
} from './variables.service.types';

interface VariableChangeEventTargetInput {
  targetId: string;
  targetType: 'environment' | 'resource' | 'service';
}

interface SetVariableChangeEventRecordInput extends VariableChangeEventTargetInput {
  actorPrincipalId: string;
  encryptedValue: EncryptedVariableValue;
  keyName: string;
  organizationId: string;
  sensitivity: VariableSensitivity;
}

export function buildShowVariableAfterWriteInput(
  input: SetVariableInput,
  target: VariableTargetContext,
): ShowVariableInput {
  return {
    environmentName: target.environment.name,
    keyName: input.keyName,
    organizationSlug: input.organizationSlug,
    principalId: input.principalId,
    projectName: target.project.name,
    ...(target.resourceName !== null ? { resourceName: target.resourceName } : {}),
    ...(target.serviceName !== null ? { serviceName: target.serviceName } : {}),
  };
}

export function buildSetVariableChangeEventInput(
  input: SetVariableInput,
  target: VariableTargetContext,
  sensitivity: VariableSensitivity,
  encryptedValue: EncryptedVariableValue,
): InsertVariableChangeEventInput {
  return buildSetVariableChangeEventRecord({
    actorPrincipalId: input.principalId,
    encryptedValue,
    keyName: input.keyName,
    organizationId: target.organization.id,
    sensitivity,
    ...buildVariableChangeEventTargetInput(target),
  });
}

export function buildSetVariableChangeEventRecord(
  input: SetVariableChangeEventRecordInput,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    fingerprintsJson: JSON.stringify([input.encryptedValue.valueFingerprint]),
    keyNamesJson: JSON.stringify([input.keyName]),
    operation: 'set',
    organizationId: input.organizationId,
    sensitivityJson: JSON.stringify([input.sensitivity]),
    targetId: input.targetId,
    targetType: input.targetType,
  };
}

export function buildRemoveVariableChangeEventInput(
  input: RemoveVariableInput,
  target: VariableTargetContext,
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    keyNamesJson: JSON.stringify([input.keyName]),
    operation: 'remove',
    organizationId: target.organization.id,
    ...buildVariableChangeEventTargetInput(target),
  };
}

export function buildImportVariableChangeEventInput(
  input: ImportVariablesInput,
  target: VariableTargetContext,
  sensitivity: VariableSensitivity,
  fingerprints: readonly string[],
): InsertVariableChangeEventInput {
  return {
    actorPrincipalId: input.principalId,
    fingerprintsJson: JSON.stringify(fingerprints),
    keyNamesJson: JSON.stringify(input.entries.map((entry: VariableImportEntry): string => entry.keyName)),
    operation: input.replace === true ? 'replace' : 'import',
    organizationId: target.organization.id,
    sensitivityJson: JSON.stringify(input.entries.map((): VariableSensitivity => sensitivity)),
    ...buildVariableChangeEventTargetInput(target),
  };
}

export function buildUpsertVariableInput(
  input: SetVariableInput,
  target: VariableTargetContext,
  id: string,
  now: Date,
  sensitivity: VariableSensitivity,
  encryptedValue: EncryptedVariableValue,
): UpsertEnvironmentVariableValueInput {
  return {
    createdByPrincipalId: input.principalId,
    encryptionKeyId: encryptedValue.encryptionKeyId,
    environmentId: target.environment.id,
    id,
    keyName: input.keyName,
    projectServiceId: target.service?.id ?? null,
    targetResourceName: target.resourceName,
    sensitivity,
    updatedAt: now,
    updatedByPrincipalId: input.principalId,
    valueCiphertext: encryptedValue.valueCiphertext,
    valueFingerprint: encryptedValue.valueFingerprint,
  };
}

export function findDuplicateImportedKeyNames(input: ImportVariablesInput): string[] {
  const seenKeyNames: Set<string> = new Set<string>();
  const duplicateKeyNames: Set<string> = new Set<string>();

  for (const entry of input.entries) {
    if (seenKeyNames.has(entry.keyName)) {
      duplicateKeyNames.add(entry.keyName);
      continue;
    }

    seenKeyNames.add(entry.keyName);
  }

  return [...duplicateKeyNames].sort((left: string, right: string): number => left.localeCompare(right));
}

function buildVariableChangeEventTargetInput(target: VariableTargetContext): VariableChangeEventTargetInput {
  if (target.resourceName !== null) {
    return {
      targetId: target.resourceName,
      targetType: 'resource',
    };
  }

  if (target.service !== null) {
    return {
      targetId: target.service.id,
      targetType: 'service',
    };
  }

  return {
    targetId: target.environment.id,
    targetType: 'environment',
  };
}
