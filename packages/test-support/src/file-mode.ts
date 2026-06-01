import { constants as fsConstants } from 'node:fs';

const fileModePermissionMask: number = fsConstants.S_IRWXU | fsConstants.S_IRWXG | fsConstants.S_IRWXO;

export function readFileModePermissions(mode: number): number {
  return mode & fileModePermissionMask;
}
