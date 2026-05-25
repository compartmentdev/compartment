import { z } from 'zod';
import { isLiteralRepositoryRelativePath, normalizeRepositoryRelativePath } from './repository-relative-path.contract';
import type { ContractSchema } from './schema.types';
import type {
  CompartmentSkillInstallFile,
  CompartmentSkillInstallFileKind,
  CompartmentSkillInstallFileStatus,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallResult,
  CompartmentSkillInstallTarget,
} from './skill-install.types';

export type {
  CompartmentSkillInstallFile,
  CompartmentSkillInstallFileKind,
  CompartmentSkillInstallFileStatus,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallResult,
  CompartmentSkillInstallTarget,
} from './skill-install.types';

export const compartmentSkillInstallTargetValues: readonly [
  CompartmentSkillInstallTarget,
  CompartmentSkillInstallTarget,
  CompartmentSkillInstallTarget,
  CompartmentSkillInstallTarget,
] = ['codex', 'claude', 'cursor', 'copilot'];
export const compartmentSkillInstallRequestedTargetValues: readonly [
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallRequestedTarget,
  CompartmentSkillInstallRequestedTarget,
] = ['auto', 'all', 'codex', 'claude', 'cursor', 'copilot'];
const compartmentSkillInstallFileKindValues: readonly [
  CompartmentSkillInstallFileKind,
  CompartmentSkillInstallFileKind,
  CompartmentSkillInstallFileKind,
] = ['instructions', 'rule', 'skill'];
const compartmentSkillInstallFileStatusValues: readonly [
  CompartmentSkillInstallFileStatus,
  CompartmentSkillInstallFileStatus,
  CompartmentSkillInstallFileStatus,
] = ['created', 'unchanged', 'updated'];
export const compartmentSkillInstallRequestedTargetSchema: ContractSchema<CompartmentSkillInstallRequestedTarget> =
  z.enum(compartmentSkillInstallRequestedTargetValues);

const compartmentSkillInstallTargetSchema: ContractSchema<CompartmentSkillInstallTarget> = z.enum(
  compartmentSkillInstallTargetValues,
);
const compartmentSkillInstallFileKindSchema: ContractSchema<CompartmentSkillInstallFileKind> = z.enum(
  compartmentSkillInstallFileKindValues,
);
const compartmentSkillInstallFileStatusSchema: ContractSchema<CompartmentSkillInstallFileStatus> = z.enum(
  compartmentSkillInstallFileStatusValues,
);
const repositoryRelativeDirectoryPathSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .transform(normalizeRepositoryRelativePath)
  .refine(isValidRepositoryRelativeDirectoryPath, 'Expected a normalized repository-relative path.');
const repositoryRelativeFilePathSchema: ContractSchema<string> = z
  .string()
  .min(1)
  .transform(normalizeRepositoryRelativePath)
  .refine(
    (value: string): boolean => value !== '.' && isLiteralRepositoryRelativePath(value),
    'Expected a normalized repository-relative file path.',
  );

const compartmentSkillInstallFileSchema: ContractSchema<CompartmentSkillInstallFile> = z
  .object({
    kind: compartmentSkillInstallFileKindSchema,
    path: repositoryRelativeFilePathSchema,
    status: compartmentSkillInstallFileStatusSchema,
    target: compartmentSkillInstallTargetSchema,
  })
  .strict();

export const compartmentSkillInstallResultSchema: ContractSchema<CompartmentSkillInstallResult> = z
  .object({
    files: z.array(compartmentSkillInstallFileSchema).min(1),
    requestedTarget: compartmentSkillInstallRequestedTargetSchema,
    resolvedTargets: z.array(compartmentSkillInstallTargetSchema).min(1),
    scopePath: repositoryRelativeDirectoryPathSchema,
  })
  .strict();

function isValidRepositoryRelativeDirectoryPath(value: string): boolean {
  return value === '.' || isLiteralRepositoryRelativePath(value);
}
