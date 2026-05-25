import {
  resolvedOptionalCompartmentServiceReleaseConfigSchema,
  type ResolvedOptionalCompartmentServiceReleaseConfig,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

export function serializeResolvedRelease(release: ResolvedOptionalCompartmentServiceReleaseConfig): string {
  return JSON.stringify(release);
}

export function parseResolvedRelease(serializedRelease: string): ResolvedOptionalCompartmentServiceReleaseConfig {
  const parsedRelease: JsonValue = JSON.parse(serializedRelease) as JsonValue;

  return resolvedOptionalCompartmentServiceReleaseConfigSchema.parse(parsedRelease);
}
