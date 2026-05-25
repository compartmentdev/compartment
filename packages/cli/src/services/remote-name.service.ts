import { compartmentRemoteNameSchema } from '@compartment/contracts';
import type { SafeParseReturnType } from 'zod';

const remoteNameRequirement: string = 'a slug starting with a letter and no longer than 63 characters';

export function assertValidRemoteName(remoteName: string): void {
  if (readValidRemoteName(remoteName) !== undefined) {
    return;
  }

  throw new Error(`Remote name "${remoteName}" is invalid. Use ${remoteNameRequirement}.`);
}

export function validateRemoteNameFormat(remoteName: string): string | undefined {
  return readValidRemoteName(remoteName) === undefined ? `Remote name must be ${remoteNameRequirement}.` : undefined;
}

function readValidRemoteName(remoteName: string): string | undefined {
  const parsedName: SafeParseReturnType<string, string> = compartmentRemoteNameSchema.safeParse(remoteName);
  return parsedName.success ? parsedName.data : undefined;
}
