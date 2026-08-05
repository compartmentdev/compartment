import { execa } from './managed-vm-command.service';

const requiredKernelModules: readonly string[] = ['overlay', 'br_netfilter', 'nf_tables'];

export async function loadManagedVmKernelModules(): Promise<void> {
  for (const module of requiredKernelModules) {
    await execa('modprobe', [module]);
  }
}
