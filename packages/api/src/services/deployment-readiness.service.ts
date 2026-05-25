import {
  resolvedOptionalServiceReadinessConfigSchema,
  type ResolvedOptionalServiceReadinessConfig,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';

export function serializeResolvedReadiness(readiness: ResolvedOptionalServiceReadinessConfig): string {
  return JSON.stringify(readiness);
}

export function parseResolvedReadiness(serializedReadiness: string): ResolvedOptionalServiceReadinessConfig {
  const parsedReadiness: JsonValue = JSON.parse(serializedReadiness) as JsonValue;
  return resolvedOptionalServiceReadinessConfigSchema.parse(parsedReadiness);
}
