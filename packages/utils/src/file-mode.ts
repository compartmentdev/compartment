import { constants as fsConstants } from 'node:fs';
import type { FileModeIdentity, FileModeOwnership } from './file-mode.types';

export function isFileModeWritableByIdentity(
  mode: number,
  ownership: FileModeOwnership,
  identity: FileModeIdentity,
): boolean {
  return (
    (ownership.uid === identity.uid && hasFileModePermission(mode, fsConstants.S_IWUSR)) ||
    (ownership.gid === identity.gid && hasFileModePermission(mode, fsConstants.S_IWGRP)) ||
    hasFileModePermission(mode, fsConstants.S_IWOTH)
  );
}

function hasFileModePermission(mode: number, permission: number): boolean {
  return (mode & permission) !== 0;
}
