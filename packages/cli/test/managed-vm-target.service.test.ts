import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { KubernetesInstallKubeconfigResolutionError } from '../src/services/kubernetes-install-kubeconfig.error';
import { selectInstallTarget } from '../src/services/managed-vm-target.service';
import type { InstallTargetDiscovery } from '../src/services/managed-vm-target.service.types';

interface InstallTargetMocks {
  resolveKubeconfig: Mock;
  runCommand: Mock;
}

interface TestInstallTargetInput {
  env: NodeJS.ProcessEnv;
  homeDirectory: string;
  interactive: boolean;
  managedStateExists: boolean;
}

const mocks: InstallTargetMocks = vi.hoisted(
  (): InstallTargetMocks => ({ resolveKubeconfig: vi.fn(), runCommand: vi.fn() }),
);

vi.mock('../src/services/kubernetes-install-kubeconfig.service', (): object => ({
  resolveKubernetesInstallKubeconfig: mocks.resolveKubeconfig,
}));
vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));

describe('install target selection', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.resolveKubeconfig.mockResolvedValue({
      clusterServer: 'https://cluster.example.test:6443',
      contextName: 'production',
      path: '/tmp/kubeconfig',
    });
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'yes\n' });
  });

  it('offers managed Kubernetes when no kubeconfig is usable', async (): Promise<void> => {
    mocks.resolveKubeconfig.mockRejectedValue(
      new KubernetesInstallKubeconfigResolutionError('No usable kubeconfig found.', 'no-usable-cluster'),
    );

    await expect(selectInstallTarget(interactiveInput())).resolves.toEqual({ kind: 'no-cluster', target: 'vm' });
  });

  it('returns the canonical resolved kubeconfig for an existing cluster', async (): Promise<void> => {
    await expect(selectInstallTarget(interactiveInput())).resolves.toMatchObject({
      kind: 'kubernetes',
      kubeconfig: { contextName: 'production', path: '/tmp/kubeconfig' },
      target: 'kubernetes',
    });
  });

  it('does not reinterpret an unreachable configured cluster as a clean VM', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue({ exitCode: 1, stderr: 'connection refused', stdout: '' });

    await expect(selectInstallTarget(interactiveInput())).resolves.toMatchObject({
      kind: 'unavailable-kubernetes',
      reason: 'Cannot reach Kubernetes cluster "production" at https://cluster.example.test:6443.',
      target: 'kubernetes',
    });
  });

  it('reports missing kubectl for a configured cluster', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue({
      exitCode: 127,
      failure: { command: 'kubectl', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    });

    const discovery: InstallTargetDiscovery = await selectInstallTarget(interactiveInput());

    expect(discovery.kind).toBe('unavailable-kubernetes');
    if (discovery.kind !== 'unavailable-kubernetes') {
      throw new Error('Expected unavailable Kubernetes discovery.');
    }
    expect(discovery.reason).toContain('kubectl not found on PATH');
  });

  it('reports insufficient Kubernetes access without falling back to the VM', async (): Promise<void> => {
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'no\n' });

    const discovery: InstallTargetDiscovery = await selectInstallTarget(interactiveInput());

    expect(discovery.kind).toBe('unavailable-kubernetes');
    if (discovery.kind !== 'unavailable-kubernetes') {
      throw new Error('Expected unavailable Kubernetes discovery.');
    }
    expect(discovery.reason).toBe('Kubernetes identity for context "production" cannot get namespaces.');
  });

  it('keeps retained managed state on the resumable VM path', async (): Promise<void> => {
    await expect(selectInstallTarget({ ...interactiveInput(), managedStateExists: true })).resolves.toEqual({
      kind: 'managed-resume',
      target: 'vm',
    });
    expect(mocks.resolveKubeconfig).not.toHaveBeenCalled();
  });

  it('honors an explicit target without discovery', async (): Promise<void> => {
    await expect(selectInstallTarget({ ...interactiveInput(), explicitTarget: 'kubernetes' })).resolves.toEqual({
      kind: 'explicit',
      target: 'kubernetes',
    });
    expect(mocks.resolveKubeconfig).not.toHaveBeenCalled();
  });

  it('requires the automation target explicitly', async (): Promise<void> => {
    await expect(selectInstallTarget({ ...interactiveInput(), interactive: false })).rejects.toThrow(
      '--target vm|kubernetes',
    );
  });
});

function interactiveInput(): TestInstallTargetInput {
  return { env: {}, homeDirectory: '/tmp/home', interactive: true, managedStateExists: false };
}
