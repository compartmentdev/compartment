import {
  resolvedCompartmentServiceRunConfigSchema,
  type ResolvedCompartmentServiceRunConfig,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

export function serializeResolvedRun(run: ResolvedCompartmentServiceRunConfig): string {
  return JSON.stringify(run);
}

export function parseResolvedRun(serializedRun: string): ResolvedCompartmentServiceRunConfig {
  const parsedRun: JsonValue = JSON.parse(serializedRun) as JsonValue;

  return resolvedCompartmentServiceRunConfigSchema.parse(parsedRun);
}
