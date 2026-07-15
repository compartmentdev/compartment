import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';
import { variableKeyNameSchema } from './variable-key.contract';
import type {
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResourceConfigInput,
  CompartmentResourceOperationConfig,
  CompartmentResourceOperationRetentionConfig,
  CompartmentResourceOperationsConfig,
  CompartmentResourceOperationScheduleConfig,
  CompartmentResourceOperationScheduleInterval,
  CompartmentResourceOutputConfig,
  CompartmentResourceReadinessConfig,
} from './compartment-descriptor.types';
import {
  compartmentResourceGeneratedVariablesSchema,
  validateCompartmentResourceGeneratedVariables,
} from './compartment-resource-generated-variable.contract';
import {
  type CompartmentAuthoredResourceConfigRawInput,
  compartmentResourcePresetValues,
  normalizeCompartmentResourcePreset,
  resolveCompartmentAuthoredResourceConfigInput,
  validateCompartmentResourcePresetOverrides,
} from './compartment-resource-preset.contract';
import {
  compartmentResourceVolumeValueSchema,
  createResourceVolumeNameSchema,
} from './compartment-resource-volume.contract';
import type { ContractSchema } from './schema.types';

export const compartmentResourceReadinessFieldNames: readonly ['type', 'port', 'timeoutMs'] = [
  'type',
  'port',
  'timeoutMs',
];
export const compartmentResourceOperationFieldNames: readonly ['command', 'env', 'image', 'schedule'] = [
  'command',
  'env',
  'image',
  'schedule',
];
const compartmentResourceOperationScheduleIntervalValues: readonly ['daily', 'hourly'] = ['daily', 'hourly'];
const standardCronExpressionFieldCount: number = 5;
export const compartmentResourceOperationScheduleFieldNames: readonly ['cron', 'interval', 'retention'] = [
  'cron',
  'interval',
  'retention',
];
export const compartmentResourceOperationRetentionFieldNames: readonly ['includeManual', 'keepLast', 'maxAgeDays'] = [
  'includeManual',
  'keepLast',
  'maxAgeDays',
];
export const compartmentDescriptorResourceConfigFieldNames: readonly [
  'command',
  'env',
  'generatedVariables',
  'image',
  'operations',
  'outputs',
  'ports',
  'preset',
  'readiness',
  'volumes',
] = [
  'command',
  'env',
  'generatedVariables',
  'image',
  'operations',
  'outputs',
  'ports',
  'preset',
  'readiness',
  'volumes',
];
export const compartmentDescriptorResourceConfigRequiredFieldSets: readonly [readonly ['image'], readonly ['preset']] =
  [['image'], ['preset']];
export const compartmentResourceOutputFieldNames: readonly ['sensitive', 'value'] = ['sensitive', 'value'];

const compartmentResourceReadinessConfigSchema: ContractSchema<CompartmentResourceReadinessConfig> = z
  .object({
    type: z.literal('tcp'),
    port: z.number().int().min(1).max(65_535),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
  })
  .strict();
const compartmentResourceEnvValueSchema: ContractSchema<string> = z.string();
const compartmentResourceEnvSchema: ContractSchema<Record<string, string>> = z.record(
  variableKeyNameSchema,
  compartmentResourceEnvValueSchema,
);
export const compartmentResourceOperationRetentionConfigSchema: ContractSchema<CompartmentResourceOperationRetentionConfig> =
  z
    .object({
      includeManual: z.boolean().optional(),
      keepLast: z.number().int().positive().optional(),
      maxAgeDays: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (retention: CompartmentResourceOperationRetentionConfig): boolean =>
        retention.keepLast !== undefined || retention.maxAgeDays !== undefined,
      {
        message: 'retention requires keepLast or maxAgeDays.',
      },
    );
export const compartmentResourceOperationScheduleConfigSchema: ContractSchema<CompartmentResourceOperationScheduleConfig> =
  z
    .object({
      cron: z
        .string()
        .trim()
        .refine(isCompartmentResourceOperationCronExpression, {
          message: 'cron must be a valid standard 5-field cron expression.',
        })
        .optional(),
      interval: z.enum(compartmentResourceOperationScheduleIntervalValues).optional(),
      retention: compartmentResourceOperationRetentionConfigSchema.optional(),
    })
    .strict()
    .refine(
      (schedule: CompartmentResourceOperationScheduleConfig): boolean =>
        (schedule.cron === undefined) !== (schedule.interval === undefined),
      {
        message: 'schedule requires exactly one of interval or cron.',
      },
    );
const compartmentResourceOperationConfigSchema: ContractSchema<CompartmentResourceOperationConfig> = z
  .object({
    command: z.string().trim().min(1),
    env: compartmentResourceEnvSchema.optional(),
    image: z.string().trim().min(1).optional(),
    schedule: compartmentResourceOperationScheduleConfigSchema.optional(),
  })
  .strict();
const compartmentResourceOperationsConfigSchema: ContractSchema<CompartmentResourceOperationsConfig> = z
  .object({
    backup: compartmentResourceOperationConfigSchema.optional(),
    restore: compartmentResourceOperationConfigSchema.optional(),
  })
  .strict()
  .superRefine((operations: CompartmentResourceOperationsConfig, context: z.RefinementCtx): void => {
    if (operations.restore?.schedule === undefined) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only backup operations can be scheduled.',
      path: ['restore', 'schedule'],
    });
  });
export const compartmentResourceOutputNamePatternText: string = '^[a-z0-9][a-z0-9_.-]{0,62}$';
export const compartmentResourceOutputNameSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .regex(new RegExp(compartmentResourceOutputNamePatternText, 'u'));
const compartmentResourceOutputConfigSchema: ContractSchema<CompartmentResourceOutputConfig> = z
  .object({
    sensitive: z.boolean(),
    value: z.string().min(1),
  })
  .strict();

const compartmentAuthoredResourceConfigInputSchema: ContractSchema<
  CompartmentAuthoredResourceConfigInput,
  CompartmentAuthoredResourceConfigRawInput
> = z
  .object({
    command: z.array(z.string().min(1)).min(1).optional(),
    env: compartmentResourceEnvSchema.optional(),
    generatedVariables: compartmentResourceGeneratedVariablesSchema.optional(),
    image: z.string().min(1).optional(),
    operations: compartmentResourceOperationsConfigSchema.optional(),
    outputs: z.record(compartmentResourceOutputNameSchema, compartmentResourceOutputConfigSchema).optional(),
    ports: z.array(z.number().int().min(1).max(65_535)).optional(),
    preset: z.enum(compartmentResourcePresetValues).optional(),
    readiness: compartmentResourceReadinessConfigSchema.optional(),
    volumes: z.record(createResourceVolumeNameSchema(), compartmentResourceVolumeValueSchema).optional(),
  })
  .strict()
  .superRefine((resource: CompartmentAuthoredResourceConfigRawInput, context: z.RefinementCtx): void => {
    if (resource.image === undefined && resource.preset === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Resource config requires image or preset.',
        path: ['image'],
      });
    }

    validateCompartmentResourcePresetOverrides(resource, context);
    validateCompartmentResourceGeneratedVariables(resource, context);
  })
  .transform(resolveCompartmentAuthoredResourceConfigInput);

const normalizedCompartmentAuthoredResourceConfigSchema: ContractSchema<
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResourceConfigRawInput
> = compartmentAuthoredResourceConfigInputSchema
  .transform(normalizeCompartmentResourcePreset)
  .superRefine((resource: CompartmentAuthoredResourceConfig, context: z.RefinementCtx): void => {
    if (resource.readiness === undefined || resource.ports?.includes(resource.readiness.port) === true) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'readiness.port must reference a declared resource port.',
      path: ['readiness', 'port'],
    });
  });
export const compartmentAuthoredResourceConfigSchema: ContractSchema<
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResourceConfigInput
> = normalizedCompartmentAuthoredResourceConfigSchema as ContractSchema<
  CompartmentAuthoredResourceConfig,
  CompartmentAuthoredResourceConfigInput
>;

export function readCompartmentResourceOperationScheduleIntervals(): [
  CompartmentResourceOperationScheduleInterval,
  CompartmentResourceOperationScheduleInterval,
] {
  return [...compartmentResourceOperationScheduleIntervalValues];
}

export function isCompartmentResourceOperationCronExpression(cron: string): boolean {
  const expression: string = cron.trim();
  if (expression.split(/\s+/u).length !== standardCronExpressionFieldCount) {
    return false;
  }

  try {
    CronExpressionParser.parse(expression, { tz: 'UTC' });
    return true;
  } catch {
    return false;
  }
}
