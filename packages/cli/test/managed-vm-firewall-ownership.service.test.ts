import { describe, expect, it, vi, type Mock } from 'vitest';

const command: Mock = vi.hoisted((): Mock => vi.fn());
vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: command }));

describe('managed VM firewall ownership', (): void => {
  it('refuses to replace a live foreign table with the owned name', async (): Promise<void> => {
    command.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'table inet compartment { chain foreign {} }' });
    const { installManagedVmFirewall } = await import('../src/services/managed-vm-firewall.service');
    await expect(installManagedVmFirewall('ens3')).rejects.toThrow('foreign nftables table');
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('recognizes the complete owned live ruleset', async (): Promise<void> => {
    command.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: 'ens3 compartment-owned 2379 2380 6443 10250 8472',
    });
    const { verifyManagedVmFirewall } = await import('../src/services/managed-vm-firewall.service');
    await expect(verifyManagedVmFirewall('ens3')).resolves.toBe(true);
  });
});
