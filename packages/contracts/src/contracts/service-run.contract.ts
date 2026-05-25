import { z } from 'zod';
import type { ResolvedCompartmentServiceBuildPacker } from './service-build.contract';
import type { ContractSchema } from './schema.types';

export type CompartmentServiceRestartPolicy = 'no' | 'on-failure' | 'unless-stopped';
export type CompartmentServiceRestartMaxRetriesPolicy = 'on-failure';
export const compartmentServiceRestartPolicyValues: readonly [
  CompartmentServiceRestartPolicy,
  CompartmentServiceRestartPolicy,
  CompartmentServiceRestartPolicy,
] = ['no', 'on-failure', 'unless-stopped'];
export const compartmentServiceRestartMaxRetriesPolicyValues: readonly [CompartmentServiceRestartMaxRetriesPolicy] = [
  'on-failure',
];
export const compartmentServiceRunFieldNames: readonly ['command', 'restart'] = ['command', 'restart'];
export const compartmentServiceRestartFieldNames: readonly ['policy', 'maxRetries'] = ['policy', 'maxRetries'];

export interface CompartmentServiceRestartConfig {
  maxRetries?: number | undefined;
  policy: CompartmentServiceRestartPolicy;
}

export interface ResolvedCompartmentServiceRestartConfig {
  maxRetries?: number | undefined;
  policy: CompartmentServiceRestartPolicy;
}

export interface CompartmentServiceRunConfig {
  command?: string | undefined;
  restart?: CompartmentServiceRestartConfig | undefined;
}

export interface ResolvedCompartmentServiceRunConfig {
  command?: string | undefined;
  restart: ResolvedCompartmentServiceRestartConfig;
}

const defaultCompartmentServiceRestartPolicy: ResolvedCompartmentServiceRestartConfig = {
  policy: 'on-failure',
};

const compartmentServiceRestartPolicySchema: ContractSchema<CompartmentServiceRestartPolicy> = z.enum(
  compartmentServiceRestartPolicyValues,
);

const compartmentServiceRestartConfigSchema: ContractSchema<CompartmentServiceRestartConfig> = z
  .object({
    maxRetries: z.number().int().positive().optional(),
    policy: compartmentServiceRestartPolicySchema,
  })
  .strict()
  .superRefine((restart: CompartmentServiceRestartConfig, context: z.RefinementCtx): void => {
    if (restart.maxRetries === undefined || restart.policy === 'on-failure') {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'restart.maxRetries is only supported with the on-failure policy.',
      path: ['maxRetries'],
    });
  });

const resolvedCompartmentServiceRestartConfigSchema: ContractSchema<ResolvedCompartmentServiceRestartConfig> = z
  .object({
    maxRetries: z.number().int().positive().optional(),
    policy: compartmentServiceRestartPolicySchema,
  })
  .strict()
  .superRefine((restart: ResolvedCompartmentServiceRestartConfig, context: z.RefinementCtx): void => {
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
    restart: compartmentServiceRestartConfigSchema.optional(),
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
    restart: resolvedCompartmentServiceRestartConfigSchema,
  })
  .strict();

export function resolveCompartmentServiceRunConfig(
  run: CompartmentServiceRunConfig | undefined,
): ResolvedCompartmentServiceRunConfig {
  return resolvedCompartmentServiceRunConfigSchema.parse({
    ...(run?.command !== undefined ? { command: run.command } : {}),
    restart: run?.restart ?? defaultCompartmentServiceRestartPolicy,
  });
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
