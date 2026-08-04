import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const command: Mock = vi.hoisted((): Mock => vi.fn());
const access: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: command }));
vi.mock('../src/services/managed-vm-firewall.service', (): { verifyManagedVmFirewall: Mock } => ({
  verifyManagedVmFirewall: vi.fn(),
}));
vi.mock('node:fs/promises', (): { access: Mock; readFile: Mock } => ({ access, readFile: vi.fn() }));

describe('managed VM stage health', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    command.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    access.mockResolvedValue(undefined);
  });

  it('reinstalls K3s when the kubectl symlink is missing', async (): Promise<void> => {
    access.mockImplementation(
      async (path: string): Promise<void> =>
        await (path === '/usr/local/bin/kubectl' ? Promise.reject(new Error('missing')) : Promise.resolve()),
    );
    const { isManagedVmStageHealthy } = await import('../src/services/managed-vm-cluster-health.service');

    await expect(isManagedVmStageHealthy('installing-k3s')).resolves.toBe(false);
  });

  it('accepts K3s only when its binaries and kubectl are available', async (): Promise<void> => {
    const { isManagedVmStageHealthy } = await import('../src/services/managed-vm-cluster-health.service');

    await expect(isManagedVmStageHealthy('installing-k3s')).resolves.toBe(true);
    expect(access).toHaveBeenCalledWith('/usr/local/bin/kubectl', expect.any(Number));
  });

  it('requires every cert-manager deployment rollout to be ready', async (): Promise<void> => {
    command.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    command.mockResolvedValueOnce({ exitCode: 1, stderr: 'deployment is not ready', stdout: '' });
    const { isManagedVmStageHealthy } = await import('../src/services/managed-vm-cluster-health.service');

    await expect(isManagedVmStageHealthy('installing-cert-manager')).resolves.toBe(false);
    expect(command).toHaveBeenCalledWith(
      'k3s',
      expect.arrayContaining(['rollout', 'status', 'deployment/cert-manager-webhook']),
      { reject: false },
    );
  });

  it('requires CoreDNS and Traefik rollouts to be ready', async (): Promise<void> => {
    command.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    command.mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '' });
    command.mockResolvedValueOnce({ exitCode: 1, stderr: 'deployment is not ready', stdout: '' });
    const { isManagedVmStageHealthy } = await import('../src/services/managed-vm-cluster-health.service');

    await expect(isManagedVmStageHealthy('verifying-prerequisites')).resolves.toBe(false);
    expect(command).toHaveBeenCalledWith('k3s', expect.arrayContaining(['rollout', 'status', 'deployment/traefik']), {
      reject: false,
    });
  });
});
