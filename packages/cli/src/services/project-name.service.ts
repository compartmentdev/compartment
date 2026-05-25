import { compartmentProjectNameSchema } from '@compartment/contracts';
import type { SafeParseReturnType } from 'zod';

const projectNameRequirement: string =
  'a slug starting with a letter, no longer than 63 characters, and not reserved by the browser console';

export function assertValidProjectName(projectName: string): void {
  if (readValidProjectName(projectName) !== undefined) {
    return;
  }

  throw new Error(`Project name "${projectName}" is invalid. Use ${projectNameRequirement}.`);
}

export function validateProjectNameFormat(projectName: string): string | undefined {
  return readValidProjectName(projectName) === undefined
    ? `Project name must be ${projectNameRequirement}.`
    : undefined;
}

export function readValidProjectName(projectName: string): string | undefined {
  const parsedName: SafeParseReturnType<string, string> = compartmentProjectNameSchema.safeParse(projectName);
  return parsedName.success ? parsedName.data : undefined;
}
