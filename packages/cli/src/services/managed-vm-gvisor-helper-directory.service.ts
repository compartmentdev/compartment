import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import {
  managedVmSandboxRuntimeHelperNames,
  managedVmSandboxRuntimePaths,
} from './managed-vm-sandbox-runtime.constants';

const installingHelperNames: readonly string[] = managedVmSandboxRuntimeHelperNames.map(
  (name: string): string => `${name}.compartment-installing`,
);
const allowedHelperNames: readonly string[] = [...managedVmSandboxRuntimeHelperNames, ...installingHelperNames];

export async function assertManagedVmGvisorHelperDirectory(requireComplete: boolean): Promise<void> {
  const entries: Dirent[] = await readdir(managedVmSandboxRuntimePaths.gvisorBinDirectory, { withFileTypes: true });
  const observedNames: string[] = entries
    .map((entry: Dirent): string => entry.name)
    .sort((left: string, right: string): number => left.localeCompare(right));
  if (
    entries.some((entry: Dirent): boolean => !entry.isFile() || !allowedHelperNames.includes(entry.name)) ||
    (requireComplete && JSON.stringify(observedNames) !== JSON.stringify(managedVmSandboxRuntimeHelperNames))
  ) {
    throw new Error('Managed-VM provisioning found unexpected content in the gVisor helper directory.');
  }
}
