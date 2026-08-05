import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { KubernetesSystemStatusResponse } from '@compartment/contracts';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';
import { createCliCapture, type CliCommandCapture } from './cli-test.harness';

interface SystemTargetMocks {
  getKubernetesStatus: Mock;
  getManagedStatus: Mock;
  hasManagedInstallation: Mock;
  withTarget: Mock;
}

const mocks: SystemTargetMocks = vi.hoisted(
  (): SystemTargetMocks => ({
    getKubernetesStatus: vi.fn(),
    getManagedStatus: vi.fn(),
    hasManagedInstallation: vi.fn(),
    withTarget: vi.fn(),
  }),
);

vi.mock('../src/services/managed-vm-installation.service', (): object => ({
  hasManagedVmInstallation: mocks.hasManagedInstallation,
}));
vi.mock('../src/services/managed-vm-lifecycle.service', (): object => ({
  getManagedVmSystemStatus: mocks.getManagedStatus,
  updateManagedVmInstallation: vi.fn(),
}));
vi.mock('../src/services/kubernetes-system-lifecycle.service', (): object => ({
  getKubernetesSystemStatus: mocks.getKubernetesStatus,
  restartKubernetesSystem: vi.fn(),
  updateKubernetesSystem: vi.fn(),
}));
vi.mock('../src/services/kubernetes-operator-target.service', (): object => ({
  withResolvedKubernetesOperatorTarget: mocks.withTarget,
}));

describe('system managed VM target selection', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.hasManagedInstallation.mockResolvedValue(true);
    mocks.getManagedStatus.mockResolvedValue({
      installationId: 'install-123',
      k3sActive: true,
      k3sVersion: 'v1.35.1',
      provisionerStage: 'complete',
    });
    mocks.getKubernetesStatus.mockResolvedValue(kubernetesStatus());
    mocks.withTarget.mockImplementation(
      async (
        target: KubernetesOperatorTarget,
        handler: (resolved: KubernetesOperatorTarget) => Promise<object>,
      ): Promise<object> => await handler({ ...target, kubeconfigPath: '/external/config' }),
    );
  });

  it.each([
    ['--kube-context', 'external'],
    ['--namespace', 'external'],
    ['--release-name', 'external'],
  ])('honors explicit Kubernetes target option %s', async (option: string, value: string): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const { runCli } = await import('../src/app');

    expect(await runCli(['system', 'status', option, value, '--output', 'json'], capture.io)).toBe(0);
    expect(mocks.withTarget).toHaveBeenCalledOnce();
    expect(mocks.getManagedStatus).not.toHaveBeenCalled();
  });

  it('uses the managed VM target when no Kubernetes target option is supplied', async (): Promise<void> => {
    const capture: CliCommandCapture = createCliCapture();
    const { runCli } = await import('../src/app');

    expect(await runCli(['system', 'status', '--output', 'json'], capture.io)).toBe(0);
    expect(mocks.withTarget).not.toHaveBeenCalled();
    expect(mocks.getManagedStatus).toHaveBeenCalledOnce();
    expect(mocks.getKubernetesStatus).toHaveBeenCalledWith(
      expect.objectContaining({ kubeconfigPath: '/etc/rancher/k3s/k3s.yaml' }),
    );
  });
});

function kubernetesStatus(): KubernetesSystemStatusResponse {
  return {
    ready: true,
    releaseName: 'compartment',
    releaseStatus: 'deployed',
    workloads: [],
  };
}
