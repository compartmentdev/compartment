import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const command: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: command }));
vi.mock('../src/services/managed-vm-firewall.service', (): { verifyManagedVmFirewall: Mock } => ({
  verifyManagedVmFirewall: vi.fn(),
}));

describe('managed VM stage health', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    command.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
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
