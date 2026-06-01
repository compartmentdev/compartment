import type { FileModeIdentity, FileModeOwnership } from './file-mode.types';

type FileModePermissionClass = 'group' | 'other' | 'owner';

const fileModePermissionClassDivisors: Record<FileModePermissionClass, number> = {
  owner: 0o100,
  group: 0o10,
  other: 0o1,
};
const writableFileModePermissionDigits: ReadonlySet<number> = new Set([0o2, 0o3, 0o6, 0o7]);

export function isFileModeWritableByIdentity(
  mode: number,
  ownership: FileModeOwnership,
  identity: FileModeIdentity,
): boolean {
  if (ownership.uid === identity.uid) {
    return hasFileModePermission(mode, 'owner');
  }
  if (ownership.gid === identity.gid) {
    return hasFileModePermission(mode, 'group');
  }
  return hasFileModePermission(mode, 'other');
}

function hasFileModePermission(mode: number, permissionClass: FileModePermissionClass): boolean {
  return writableFileModePermissionDigits.has(readFileModePermissionDigit(mode, permissionClass));
}

function readFileModePermissionDigit(mode: number, permissionClass: FileModePermissionClass): number {
  return Math.trunc(mode / fileModePermissionClassDivisors[permissionClass]) % 0o10;
}
