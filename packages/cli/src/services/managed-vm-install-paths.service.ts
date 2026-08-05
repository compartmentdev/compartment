import { lstat } from 'node:fs/promises';

export const managedVmK3sGeneratedOwnedPaths: readonly string[] = [
  '/usr/local/bin/k3s-killall.sh',
  '/usr/local/bin/k3s-uninstall.sh',
  '/etc/systemd/system/k3s.service',
  '/etc/systemd/system/k3s.service.env',
];

export const managedVmK3sGeneratedConflictPaths: readonly string[] = [
  ...managedVmK3sGeneratedOwnedPaths,
  '/run/flannel',
  '/run/k3s',
  '/var/lib/kubelet',
  '/var/lib/rancher/k3s',
];

export async function findExistingManagedVmPaths(paths: readonly string[]): Promise<string[]> {
  const conflicts: string[] = [];
  for (const path of paths) {
    try {
      await lstat(path);
      conflicts.push(path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
  }
  return conflicts;
}
