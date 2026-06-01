import { constants as fsConstants } from 'node:fs';
import type { FileModeIdentity, FileModeOwnership } from './file-mode.types';

export function isFileModeWritableByIdentity(
  mode: number,
  ownership: FileModeOwnership,
  identity: FileModeIdentity,
): boolean {
  if (ownership.uid === identity.uid) {
    return hasFileModePermission(mode, fsConstants.S_IWUSR);
  }
  if (ownership.gid === identity.gid) {
    return hasFileModePermission(mode, fsConstants.S_IWGRP);
  }
  return hasFileModePermission(mode, fsConstants.S_IWOTH);
}

function hasFileModePermission(mode: number, permission: number): boolean {
  return (mode & permission) !== 0;
}
