import type {
  CompartmentAuthoredResourceConfig,
  CompartmentResourceEnv,
  CompartmentResourceGeneratedVariableConfig,
  CompartmentResourceGeneratedVariables,
  CompartmentResourceOperationConfig,
  CompartmentResourceOperationRetentionConfig,
  CompartmentResourceOperationScheduleConfig,
  CompartmentResourceOperationsConfig,
  CompartmentResourceOutputConfig,
  CompartmentResourceOutputs,
  CompartmentResourcePreset,
  CompartmentResourceReadinessConfig,
  CompartmentResourceVolumes,
  CompartmentResourceVolumeValue,
} from './compartment-descriptor.types';
import type { CompartmentAuthoredResourceConfigRawInput } from './compartment-resource-preset.contract';

export function isSerializedNormalizedPresetResource(
  resource: CompartmentAuthoredResourceConfigRawInput,
  presets: Record<CompartmentResourcePreset, CompartmentAuthoredResourceConfig>,
): boolean {
  if (resource.preset === undefined) {
    return false;
  }

  const preset: CompartmentAuthoredResourceConfig = presets[resource.preset];
  return (
    areOptionalStringArraysEqual(resource.command, preset.command) &&
    areResourceGeneratedVariablesEqual(
      resource.generatedVariables,
      resolvePresetGeneratedVariables(preset.generatedVariables, resource.env),
    ) &&
    resource.image === preset.image &&
    areResourceOperationsEqual(resource.operations, preset.operations) &&
    areResourceOutputsEqual(resource.outputs, preset.outputs) &&
    areOptionalNumberArraysEqual(resource.ports, preset.ports) &&
    areResourceReadinessConfigsEqual(resource.readiness, preset.readiness) &&
    areResourceVolumesEqual(resource.volumes, preset.volumes)
  );
}

function areResourceGeneratedVariablesEqual(
  left: CompartmentResourceGeneratedVariables | undefined,
  right: CompartmentResourceGeneratedVariables | undefined,
): boolean {
  return areRecordEntriesEqual(left, right, areResourceGeneratedVariableConfigsEqual);
}

function areResourceGeneratedVariableConfigsEqual(
  left: CompartmentResourceGeneratedVariableConfig | undefined,
  right: CompartmentResourceGeneratedVariableConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return areStringRecordValuesEqual(left.generator, right.generator);
}

function areResourceOperationsEqual(
  left: CompartmentResourceOperationsConfig | undefined,
  right: CompartmentResourceOperationsConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return (
    areResourceOperationConfigsEqual(left.backup, right.backup) &&
    areResourceOperationConfigsEqual(left.restore, right.restore)
  );
}

function areResourceOperationConfigsEqual(
  left: CompartmentResourceOperationConfig | undefined,
  right: CompartmentResourceOperationConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return (
    left.command === right.command &&
    areStringRecordsEqual(left.env, right.env) &&
    left.image === right.image &&
    areResourceOperationSchedulesEqual(left.schedule, right.schedule)
  );
}

function areResourceOperationSchedulesEqual(
  left: CompartmentResourceOperationScheduleConfig | undefined,
  right: CompartmentResourceOperationScheduleConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return (
    left.cron === right.cron &&
    left.interval === right.interval &&
    areResourceOperationRetentionConfigsEqual(left.retention, right.retention)
  );
}

function areResourceOperationRetentionConfigsEqual(
  left: CompartmentResourceOperationRetentionConfig | undefined,
  right: CompartmentResourceOperationRetentionConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return (
    left.includeManual === right.includeManual &&
    left.keepLast === right.keepLast &&
    left.maxAgeDays === right.maxAgeDays
  );
}

function areResourceOutputsEqual(
  left: CompartmentResourceOutputs | undefined,
  right: CompartmentResourceOutputs | undefined,
): boolean {
  return areRecordEntriesEqual(left, right, areResourceOutputConfigsEqual);
}

function areResourceOutputConfigsEqual(
  left: CompartmentResourceOutputConfig | undefined,
  right: CompartmentResourceOutputConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.sensitive === right.sensitive && left.value === right.value;
}

function areResourceReadinessConfigsEqual(
  left: CompartmentResourceReadinessConfig | undefined,
  right: CompartmentResourceReadinessConfig | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.port === right.port && left.timeoutMs === right.timeoutMs;
}

function areResourceVolumesEqual(
  left: CompartmentResourceVolumes | undefined,
  right: CompartmentResourceVolumes | undefined,
): boolean {
  return areRecordEntriesEqual(left, right, areResourceVolumeValuesEqual);
}

function areResourceVolumeValuesEqual(
  left: CompartmentResourceVolumeValue | undefined,
  right: CompartmentResourceVolumeValue | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right;
  }

  return left.mountPath === right.mountPath;
}

function areStringRecordsEqual(
  left: CompartmentResourceEnv | undefined,
  right: CompartmentResourceEnv | undefined,
): boolean {
  return areRecordEntriesEqual(left, right, areStringRecordValuesEqual);
}

function areRecordEntriesEqual<T>(
  left: Record<string, T> | undefined,
  right: Record<string, T> | undefined,
  compareValues: (left: T | undefined, right: T | undefined) => boolean,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  const leftKeys: string[] = Object.keys(left).sort(compareStrings);
  const rightKeys: string[] = Object.keys(right).sort(compareStrings);
  return (
    areOptionalStringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every((key: string): boolean => compareValues(left[key], right[key]))
  );
}

function areStringRecordValuesEqual(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function areOptionalStringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.length === right.length && left.every((value: string, index: number): boolean => value === right[index]);
}

function areOptionalNumberArraysEqual(left: number[] | undefined, right: number[] | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.length === right.length && left.every((value: number, index: number): boolean => value === right[index]);
}

function resolvePresetGeneratedVariables(
  generatedVariables: CompartmentResourceGeneratedVariables | undefined,
  env: CompartmentResourceEnv | undefined,
): CompartmentResourceGeneratedVariables | undefined {
  if (generatedVariables === undefined) {
    return undefined;
  }

  const entries: [string, CompartmentResourceGeneratedVariableConfig][] = Object.entries(generatedVariables).filter(
    ([keyName]: [string, CompartmentResourceGeneratedVariableConfig]): boolean => env?.[keyName] === undefined,
  );

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}
