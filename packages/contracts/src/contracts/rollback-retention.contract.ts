import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type RollbackRetentionMode = 'inherit' | 'indefinite' | 'keep_last';
export type RollbackRetentionEffectiveMode = 'indefinite' | 'keep_last';

export interface RollbackRetentionConfiguredPolicy {
  limit: number | null;
  mode: RollbackRetentionMode;
}

export interface RollbackRetentionEffectivePolicy {
  limit: number | null;
  mode: RollbackRetentionEffectiveMode;
}

const rollbackRetentionModeValues: readonly [RollbackRetentionMode, ...RollbackRetentionMode[]] = [
  'inherit',
  'indefinite',
  'keep_last',
];
const rollbackRetentionEffectiveModeValues: readonly [
  RollbackRetentionEffectiveMode,
  ...RollbackRetentionEffectiveMode[],
] = ['indefinite', 'keep_last'];

const rollbackRetentionModeSchema: ContractSchema<RollbackRetentionMode> = z.enum(rollbackRetentionModeValues);
const rollbackRetentionEffectiveModeSchema: ContractSchema<RollbackRetentionEffectiveMode> = z.enum(
  rollbackRetentionEffectiveModeValues,
);

export const rollbackRetentionConfiguredPolicySchema: ContractSchema<RollbackRetentionConfiguredPolicy> = z
  .object({
    limit: z.number().int().positive().nullable(),
    mode: rollbackRetentionModeSchema,
  })
  .strict()
  .superRefine(validateConfiguredRollbackRetentionPolicy);

export const rollbackRetentionEffectivePolicySchema: ContractSchema<RollbackRetentionEffectivePolicy> = z
  .object({
    limit: z.number().int().positive().nullable(),
    mode: rollbackRetentionEffectiveModeSchema,
  })
  .strict()
  .superRefine(validateEffectiveRollbackRetentionPolicy);

function validateConfiguredRollbackRetentionPolicy(
  policy: RollbackRetentionConfiguredPolicy,
  context: z.RefinementCtx,
): void {
  validateRollbackRetentionLimit(policy, context, 'rollback retention limit must be null unless mode is keep_last');
}

function validateEffectiveRollbackRetentionPolicy(
  policy: RollbackRetentionEffectivePolicy,
  context: z.RefinementCtx,
): void {
  validateRollbackRetentionLimit(policy, context, 'rollback retention limit must be null when mode is indefinite');
}

function validateRollbackRetentionLimit(
  policy: RollbackRetentionConfiguredPolicy | RollbackRetentionEffectivePolicy,
  context: z.RefinementCtx,
  nullLimitMessage: string,
): void {
  if (policy.mode === 'keep_last') {
    if (policy.limit !== null) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'rollback retention limit is required when mode is keep_last',
      path: ['limit'],
    });

    return;
  }

  if (policy.limit === null) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: nullLimitMessage,
    path: ['limit'],
  });
}
