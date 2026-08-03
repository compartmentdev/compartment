import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { managedVmStatePath, readManagedVmState } from './managed-vm-state.service';

export async function hasManagedVmInstallation(): Promise<boolean> {
  try {
    await access(managedVmStatePath, constants.R_OK);
    return (await readManagedVmState()) !== undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
