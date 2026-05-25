import { listPermissionKeys, permissionKeySchema, type PermissionKey } from '@compartment/contracts';
import type { SafeParseReturnType } from 'zod';

export function parsePermissionKeys(input: readonly string[]): PermissionKey[] {
  return input.map(parsePermissionKey);
}

function parsePermissionKey(input: string): PermissionKey {
  const parsedPermission: SafeParseReturnType<string, PermissionKey> = permissionKeySchema.safeParse(input);
  if (parsedPermission.success) {
    return parsedPermission.data;
  }

  throw new Error(`Permission must be one of ${listPermissionKeys().join(', ')}.`);
}
