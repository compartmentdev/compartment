import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export const compartmentServiceReleaseFieldNames: readonly ['command'] = ['command'];

export interface CompartmentServiceReleaseConfig {
  command: string;
}

export interface ResolvedCompartmentServiceReleaseConfig {
  command: string;
}

export type ResolvedOptionalCompartmentServiceReleaseConfig = ResolvedCompartmentServiceReleaseConfig | null;

export const compartmentServiceReleaseConfigSchema: ContractSchema<CompartmentServiceReleaseConfig> = z
  .object({
    command: z.string().min(1),
  })
  .strict();

export const resolvedCompartmentServiceReleaseConfigSchema: ContractSchema<ResolvedCompartmentServiceReleaseConfig> = z
  .object({
    command: z.string().min(1),
  })
  .strict();

export const resolvedOptionalCompartmentServiceReleaseConfigSchema: ContractSchema<ResolvedOptionalCompartmentServiceReleaseConfig> =
  resolvedCompartmentServiceReleaseConfigSchema.nullable();

export function resolveCompartmentServiceReleaseConfig(
  release: CompartmentServiceReleaseConfig | undefined,
): ResolvedOptionalCompartmentServiceReleaseConfig {
  return release === undefined ? null : resolvedCompartmentServiceReleaseConfigSchema.parse(release);
}
