import { readManagedVmState } from './managed-vm-state.service';

export async function hasManagedVmInstallation(): Promise<boolean> {
  return (await readManagedVmState()) !== undefined;
}
