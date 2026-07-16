import { z } from 'zod';
import { readContractShapeFieldNames, type ContractObjectShape } from './contract-shape';
import type { ContractSchema } from './schema.types';

export type CompartmentServiceReadinessType = 'http';

interface CompartmentHttpReadinessConfig {
  path?: string | undefined;
  timeoutMs?: number | undefined;
  type: CompartmentServiceReadinessType;
}

export type CompartmentServiceReadinessConfig = CompartmentHttpReadinessConfig;

interface ResolvedHttpReadinessConfig {
  path: string;
  timeoutMs: number;
  type: 'http';
}

export type ResolvedServiceReadinessConfig = ResolvedHttpReadinessConfig;
export type ResolvedOptionalServiceReadinessConfig = ResolvedServiceReadinessConfig | null;

const defaultHttpReadinessPath: string = '/healthz';
const defaultHttpReadinessTimeoutMs: number = 30_000;
export const compartmentServiceReadinessTypeValues: readonly [CompartmentServiceReadinessType] = ['http'];

const readinessPathSchema: ContractSchema<string> = z.string().min(1);
const readinessTimeoutSchema: ContractSchema<number> = z.number().int().positive().max(300_000);

const compartmentHttpReadinessConfigShape: ContractObjectShape = createCompartmentHttpReadinessConfigShape();

export const compartmentServiceReadinessFieldNames: string[] = readContractShapeFieldNames(
  compartmentHttpReadinessConfigShape,
);

const compartmentHttpReadinessConfigSchema: ContractSchema<CompartmentHttpReadinessConfig> = z
  .object(createCompartmentHttpReadinessConfigShape())
  .strict();

const resolvedHttpReadinessConfigSchema: ContractSchema<ResolvedHttpReadinessConfig> = z
  .object(createResolvedHttpReadinessConfigShape())
  .strict();

export const compartmentServiceReadinessConfigSchema: ContractSchema<CompartmentServiceReadinessConfig> =
  compartmentHttpReadinessConfigSchema;

const resolvedServiceReadinessConfigSchema: ContractSchema<ResolvedServiceReadinessConfig> =
  resolvedHttpReadinessConfigSchema;
export const resolvedOptionalServiceReadinessConfigSchema: ContractSchema<ResolvedOptionalServiceReadinessConfig> =
  resolvedHttpReadinessConfigSchema.nullable();

export function resolveServiceReadinessConfig(
  readiness: CompartmentServiceReadinessConfig | undefined,
): ResolvedOptionalServiceReadinessConfig {
  if (readiness === undefined) {
    return null;
  }

  return resolvedServiceReadinessConfigSchema.parse({
    path: readiness.path ?? defaultHttpReadinessPath,
    timeoutMs: readiness.timeoutMs ?? defaultHttpReadinessTimeoutMs,
    type: 'http',
  });
}

function createCompartmentHttpReadinessConfigShape(): {
  path: z.ZodOptional<typeof readinessPathSchema>;
  timeoutMs: z.ZodOptional<typeof readinessTimeoutSchema>;
  type: z.ZodLiteral<'http'>;
} {
  return {
    type: z.literal('http'),
    path: readinessPathSchema.optional(),
    timeoutMs: readinessTimeoutSchema.optional(),
  };
}

function createResolvedHttpReadinessConfigShape(): {
  path: typeof readinessPathSchema;
  timeoutMs: typeof readinessTimeoutSchema;
  type: z.ZodLiteral<'http'>;
} {
  return {
    type: z.literal('http'),
    path: readinessPathSchema,
    timeoutMs: readinessTimeoutSchema,
  };
}
