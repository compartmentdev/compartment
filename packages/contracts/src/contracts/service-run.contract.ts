import { z } from 'zod';
import type { ResolvedCompartmentServiceBuildPacker } from './service-build.contract';
import type { ContractSchema } from './schema.types';

export const compartmentServiceRunFieldNames: readonly ['command'] = ['command'];

export interface CompartmentServiceRunConfig {
  command: string;
}

export interface ResolvedCompartmentServiceRunConfig {
  command?: string | undefined;
}

export const compartmentServiceRunConfigSchema: ContractSchema<CompartmentServiceRunConfig> = z
  .object({
    command: z.string().min(1),
  })
  .strict();

export const resolvedCompartmentServiceRunConfigSchema: ContractSchema<ResolvedCompartmentServiceRunConfig> = z
  .object({
    command: z.string().min(1).optional(),
  })
  .strict();

export function resolveCompartmentServiceRunConfig(
  run: CompartmentServiceRunConfig | undefined,
): ResolvedCompartmentServiceRunConfig {
  return run === undefined ? {} : { command: run.command };
}

export function resolveCompartmentServiceRunExecution(
  run: ResolvedCompartmentServiceRunConfig,
  packer: ResolvedCompartmentServiceBuildPacker,
  servicePath: string,
): ResolvedCompartmentServiceRunConfig {
  if (run.command === undefined || packer === 'railpack') {
    return run;
  }

  throw new Error(
    `Run command is only supported for services with an authored runtime process. Service "${servicePath}" resolved to ${packer} build.`,
  );
}
