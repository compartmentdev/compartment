import { z } from 'zod';
import { compartmentDescriptorFileName } from './compartment-descriptor-guide.contract';
import { isLiteralRepositoryRelativePath, normalizeRepositoryRelativePath } from './repository-relative-path.contract';
import {
  isValidCompartmentSourcePackageRelativePath,
  normalizeCompartmentSourcePackageRelativePath,
} from './source-package.contract';

export const gitSourceRepositoryPathSchema: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeCompartmentSourcePackageRelativePath)
  .refine(isValidCompartmentSourcePackageRelativePath, 'Expected a normalized repository-relative path.');

function isValidGitSourceDescriptorPath(value: string): boolean {
  return (
    isLiteralRepositoryRelativePath(value) &&
    (value === compartmentDescriptorFileName || value.endsWith(`/${compartmentDescriptorFileName}`))
  );
}

export const gitSourceDescriptorPathSchema: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeRepositoryRelativePath)
  .refine(
    isValidGitSourceDescriptorPath,
    `Expected a normalized repository-relative ${compartmentDescriptorFileName} path.`,
  );
