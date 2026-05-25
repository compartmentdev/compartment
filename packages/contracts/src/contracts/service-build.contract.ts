import { z } from 'zod';
import { readContractShapeFieldNames, type ContractObjectShape } from './contract-shape';
import type { ContractSchema } from './schema.types';
import { compartmentServiceBuildOutputDirectorySchema } from './service-static.contract';
import { variableKeyNameSchema } from './variable-key.contract';

export type {
  ResolvedCompartmentServiceBuildExecution,
  ResolvedCompartmentServiceBuildPacker,
} from './service-build-execution.contract';
export { resolveCompartmentServiceBuildExecution } from './service-build-execution.contract';

export type CompartmentServiceBuildStrategy = 'auto' | 'dockerfile' | 'railpack';

interface CompartmentServiceBuildPackagesConfig {
  build?: string[] | undefined;
  runtime?: string[] | undefined;
}

export interface CompartmentServiceBuildConfig {
  command?: string | undefined;
  env?: string[] | undefined;
  include?: string[] | undefined;
  outputDirectory?: string | undefined;
  packages?: CompartmentServiceBuildPackagesConfig | undefined;
  strategy?: CompartmentServiceBuildStrategy | undefined;
}

interface ResolvedCompartmentServiceBuildPackagesConfig {
  build: string[];
  runtime: string[];
}
export type { ResolvedCompartmentServiceBuildPackagesConfig };

export interface ResolvedCompartmentServiceBuildConfig {
  command?: string | undefined;
  env: string[];
  include: string[];
  outputDirectory?: string | undefined;
  packages: ResolvedCompartmentServiceBuildPackagesConfig;
  strategy: CompartmentServiceBuildStrategy;
}

const defaultCompartmentServiceBuildStrategy: CompartmentServiceBuildStrategy = 'auto';
const compartmentServiceBuildPackagePattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9.+:=~-]*$/u;
const unsupportedBuildIncludeGlobPattern: RegExp = new RegExp('[*?\\[]', 'u');
const absoluteBuildIncludePathPattern: RegExp = /^(?:[A-Za-z]:[/\\]|[/\\]{1,2})/u;
export const compartmentServiceBuildStrategyValues: readonly [
  CompartmentServiceBuildStrategy,
  CompartmentServiceBuildStrategy,
  CompartmentServiceBuildStrategy,
] = ['auto', 'dockerfile', 'railpack'];
export const compartmentServiceBuildStrategySchema: ContractSchema<CompartmentServiceBuildStrategy> = z.enum(
  compartmentServiceBuildStrategyValues,
);
const compartmentServiceBuildPackageSchema: ContractSchema<string> = z
  .string()
  .regex(compartmentServiceBuildPackagePattern);
const compartmentServiceBuildIncludeSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .refine(
    (includePath: string): boolean => !absoluteBuildIncludePathPattern.test(includePath),
    'build.include entries must be relative to the directory containing compartment.yml.',
  )
  .refine(
    (includePath: string): boolean => !unsupportedBuildIncludeGlobPattern.test(includePath),
    'build.include entries must be literal file or directory paths.',
  );
const compartmentServiceBuildPackagesConfigSchema: ContractSchema<CompartmentServiceBuildPackagesConfig> = z
  .object({
    build: z.array(compartmentServiceBuildPackageSchema).optional(),
    runtime: z.array(compartmentServiceBuildPackageSchema).optional(),
  })
  .strict()
  .superRefine((packages: CompartmentServiceBuildPackagesConfig, context: z.RefinementCtx): void => {
    if ((packages.build?.length ?? 0) > 0 || (packages.runtime?.length ?? 0) > 0) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'build.packages must include at least one build or runtime package.',
      path: [],
    });
  });
const resolvedCompartmentServiceBuildPackagesConfigSchema: ContractSchema<ResolvedCompartmentServiceBuildPackagesConfig> =
  z
    .object({
      build: z.array(compartmentServiceBuildPackageSchema),
      runtime: z.array(compartmentServiceBuildPackageSchema),
    })
    .strict();
const compartmentServiceBuildShape: ContractObjectShape = createCompartmentServiceBuildShape();

export const compartmentServiceBuildFieldNames: string[] = readContractShapeFieldNames(compartmentServiceBuildShape);

export const compartmentServiceBuildConfigSchema: ContractSchema<CompartmentServiceBuildConfig> = z
  .object(compartmentServiceBuildShape)
  .strict()
  .superRefine((build: CompartmentServiceBuildConfig, context: z.RefinementCtx): void => {
    if (build.strategy === 'dockerfile' && build.command !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'build.command is only supported when the build strategy resolves to Railpack.',
        path: ['command'],
      });
    }
    if (build.strategy === 'dockerfile' && build.packages !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'build.packages is only supported when the build strategy resolves to Railpack.',
        path: ['packages'],
      });
    }
    if (build.strategy === 'dockerfile' && build.outputDirectory !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'build.outputDirectory is only supported when the build strategy resolves to Railpack.',
        path: ['outputDirectory'],
      });
    }
  });

export const resolvedCompartmentServiceBuildConfigSchema: ContractSchema<ResolvedCompartmentServiceBuildConfig> = z
  .object({
    command: z.string().min(1).optional(),
    env: z.array(variableKeyNameSchema),
    include: z.array(compartmentServiceBuildIncludeSchema),
    outputDirectory: compartmentServiceBuildOutputDirectorySchema.optional(),
    packages: resolvedCompartmentServiceBuildPackagesConfigSchema,
    strategy: compartmentServiceBuildStrategySchema,
  })
  .strict();

export function resolveCompartmentServiceBuildConfig(
  build: CompartmentServiceBuildConfig | undefined,
): ResolvedCompartmentServiceBuildConfig {
  return resolvedCompartmentServiceBuildConfigSchema.parse({
    ...(build?.command !== undefined ? { command: build.command } : {}),
    env: [...(build?.env ?? [])],
    include: [...(build?.include ?? [])],
    ...(build?.outputDirectory !== undefined ? { outputDirectory: build.outputDirectory } : {}),
    packages: resolveCompartmentServiceBuildPackagesConfig(build?.packages),
    strategy: build?.strategy ?? defaultCompartmentServiceBuildStrategy,
  });
}

function createCompartmentServiceBuildShape(): {
  command: z.ZodOptional<z.ZodString>;
  env: z.ZodOptional<z.ZodArray<typeof variableKeyNameSchema>>;
  include: z.ZodOptional<z.ZodArray<typeof compartmentServiceBuildIncludeSchema>>;
  outputDirectory: z.ZodOptional<typeof compartmentServiceBuildOutputDirectorySchema>;
  packages: z.ZodOptional<typeof compartmentServiceBuildPackagesConfigSchema>;
  strategy: z.ZodOptional<typeof compartmentServiceBuildStrategySchema>;
} {
  return {
    command: z.string().min(1).optional(),
    env: z.array(variableKeyNameSchema).optional(),
    include: z.array(compartmentServiceBuildIncludeSchema).optional(),
    outputDirectory: compartmentServiceBuildOutputDirectorySchema.optional(),
    packages: compartmentServiceBuildPackagesConfigSchema.optional(),
    strategy: compartmentServiceBuildStrategySchema.optional(),
  };
}

function resolveCompartmentServiceBuildPackagesConfig(
  packages: CompartmentServiceBuildPackagesConfig | undefined,
): ResolvedCompartmentServiceBuildPackagesConfig {
  return resolvedCompartmentServiceBuildPackagesConfigSchema.parse({
    build: [...(packages?.build ?? [])],
    runtime: [...(packages?.runtime ?? [])],
  });
}
