import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type AuditRetentionMode = 'inherit' | 'indefinite' | 'keep_days';
export type AuditRetentionEffectiveMode = 'indefinite' | 'keep_days';

export interface AuditRetentionConfiguredPolicy {
  days: number | null;
  mode: AuditRetentionMode;
}

export interface AuditRetentionEffectivePolicy {
  days: number | null;
  mode: AuditRetentionEffectiveMode;
}

const auditRetentionModeValues: readonly [AuditRetentionMode, ...AuditRetentionMode[]] = [
  'inherit',
  'indefinite',
  'keep_days',
];
const auditRetentionEffectiveModeValues: readonly [AuditRetentionEffectiveMode, ...AuditRetentionEffectiveMode[]] = [
  'indefinite',
  'keep_days',
];

const auditRetentionModeSchema: ContractSchema<AuditRetentionMode> = z.enum(auditRetentionModeValues);
const auditRetentionEffectiveModeSchema: ContractSchema<AuditRetentionEffectiveMode> = z.enum(
  auditRetentionEffectiveModeValues,
);

export const auditRetentionConfiguredPolicySchema: ContractSchema<AuditRetentionConfiguredPolicy> = z
  .object({
    days: z.number().int().positive().nullable(),
    mode: auditRetentionModeSchema,
  })
  .strict()
  .superRefine(validateConfiguredAuditRetentionPolicy);

export const auditRetentionEffectivePolicySchema: ContractSchema<AuditRetentionEffectivePolicy> = z
  .object({
    days: z.number().int().positive().nullable(),
    mode: auditRetentionEffectiveModeSchema,
  })
  .strict()
  .superRefine(validateEffectiveAuditRetentionPolicy);

function validateConfiguredAuditRetentionPolicy(
  policy: AuditRetentionConfiguredPolicy,
  context: z.RefinementCtx,
): void {
  validateAuditRetentionDays(policy, context, 'audit retention days must be null unless mode is keep_days');
}

function validateEffectiveAuditRetentionPolicy(policy: AuditRetentionEffectivePolicy, context: z.RefinementCtx): void {
  validateAuditRetentionDays(policy, context, 'audit retention days must be null when mode is indefinite');
}

function validateAuditRetentionDays(
  policy: AuditRetentionConfiguredPolicy | AuditRetentionEffectivePolicy,
  context: z.RefinementCtx,
  nullDaysMessage: string,
): void {
  if (policy.mode === 'keep_days') {
    if (policy.days !== null) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'audit retention days is required when mode is keep_days',
      path: ['days'],
    });

    return;
  }

  if (policy.days === null) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: nullDaysMessage,
    path: ['days'],
  });
}
