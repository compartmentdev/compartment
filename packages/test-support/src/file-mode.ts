const fileModePermissionBase: number = 0o1000;

export function readFileModePermissions(mode: number): number {
  return mode % fileModePermissionBase;
}
