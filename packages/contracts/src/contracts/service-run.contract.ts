import { z } from 'zod';
import type { ResolvedCompartmentServiceBuildPacker } from './service-build.contract';
import type { ContractSchema } from './schema.types';

export type CompartmentDeprecatedRestartPolicy = 'no' | 'on-failure' | 'unless-stopped';
export const compartmentDeprecatedRestartPolicyValues: readonly [
  CompartmentDeprecatedRestartPolicy,
  CompartmentDeprecatedRestartPolicy,
  CompartmentDeprecatedRestartPolicy,
] = ['no', 'on-failure', 'unless-stopped'];
export const compartmentServiceRunFieldNames: readonly ['command', 'restart'] = ['command', 'restart'];

export interface CompartmentDeprecatedServiceRestartConfig {
  maxRetries?: number | undefined;
  policy: CompartmentDeprecatedRestartPolicy;
}

export interface CompartmentServiceRunConfig {
  command?: string | undefined;
  restart?: CompartmentDeprecatedServiceRestartConfig | undefined;
}

export interface ResolvedCompartmentServiceRunConfig {
  command?: string | undefined;
}

const compartmentDeprecatedServiceRestartConfigSchema: ContractSchema<CompartmentDeprecatedServiceRestartConfig> = z
  .object({
    maxRetries: z.number().int().positive().optional(),
    policy: z.enum(compartmentDeprecatedRestartPolicyValues),
  })
  .strict()
  .superRefine((restart: CompartmentDeprecatedServiceRestartConfig, context: z.RefinementCtx): void => {
    if (restart.maxRetries === undefined || restart.policy === 'on-failure') {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'restart.maxRetries is only supported with the on-failure policy.',
      path: ['maxRetries'],
    });
  });

export const compartmentServiceRunConfigSchema: ContractSchema<CompartmentServiceRunConfig> = z
  .object({
    command: z.string().min(1).optional(),
    restart: compartmentDeprecatedServiceRestartConfigSchema.optional(),
  })
  .strict()
  .superRefine((run: CompartmentServiceRunConfig, context: z.RefinementCtx): void => {
    if (run.command !== undefined || run.restart !== undefined) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'run must include at least one of command or restart.',
      path: ['command'],
    });
  });

export const resolvedCompartmentServiceRunConfigSchema: ContractSchema<ResolvedCompartmentServiceRunConfig> = z
  .object({
    command: z.string().min(1).optional(),
  })
  .strict();

export function resolveCompartmentServiceRunConfig(
  run: CompartmentServiceRunConfig | undefined,
): ResolvedCompartmentServiceRunConfig {
  return run?.command === undefined ? {} : { command: run.command };
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
