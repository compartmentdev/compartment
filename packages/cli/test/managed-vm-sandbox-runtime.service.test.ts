import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';
import type { ManagedVmCommandResult } from '../src/services/managed-vm-command.service.types';

interface SandboxRuntimeMocks {
  chmod: Mock;
  copyFile: Mock;
  cp: Mock;
  execa: Mock;
  mkdir: Mock;
  readFile: Mock;
  rm: Mock;
  verifySandbox: Mock;
  writeFile: Mock;
}

const mocks: SandboxRuntimeMocks = vi.hoisted(
  (): SandboxRuntimeMocks => ({
    chmod: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
    execa: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    rm: vi.fn(),
    verifySandbox: vi.fn(),
    writeFile: vi.fn(),
  }),
);

vi.mock('node:fs/promises', (): object => ({
  chmod: mocks.chmod,
  copyFile: mocks.copyFile,
  cp: mocks.cp,
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));
vi.mock('../src/services/managed-vm-command.service', (): object => ({ execa: mocks.execa }));
vi.mock('../src/services/kubernetes-sandbox-runtime-preflight.service', (): object => ({
  verifyKubernetesSandboxRuntime: mocks.verifySandbox,
}));

describe('managed VM sandbox runtime', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue(
      'runtime_type = "io.containerd.runsc.v1"\nConfigPath = "/etc/containerd/runsc.toml"',
    );
    mocks.verifySandbox.mockResolvedValue({ detail: 'Verified gVisor sandbox.', runtimeClassName: 'gvisor' });
    mocks.execa.mockImplementation(async (file: string): Promise<ManagedVmCommandResult> => {
      if (file === '/usr/local/bin/runsc') {
        return await Promise.resolve(success('runsc version release-20260721.0'));
      }
      return await Promise.resolve(success(''));
    });
  });

  it('installs the complete runtime, restarts K3s, and proves the sandbox with a real Pod', async (): Promise<void> => {
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

    await installManagedVmSandboxRuntime(artifacts());

    expect(mocks.copyFile).toHaveBeenCalledWith('/tmp/runsc', '/usr/local/bin/runsc');
    expect(mocks.copyFile).toHaveBeenCalledWith(
      '/tmp/containerd-shim-runsc-v1',
      '/usr/local/bin/containerd-shim-runsc-v1',
    );
    expect(mocks.cp).toHaveBeenCalledWith('/tmp/gvisor-bin', '/usr/local/bin/gvisor-bin', { recursive: true });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl',
      expect.stringContaining('{{ template "base" . }}'),
      { mode: 0o600 },
    );
    expect(mocks.execa).toHaveBeenCalledWith('systemctl', ['restart', 'k3s']);
    expect(mocks.execa).toHaveBeenCalledWith('k3s', [
      'kubectl',
      'wait',
      '--for=create',
      'serviceaccount/default',
      '--timeout=5m',
    ]);
    expect(mocks.verifySandbox).toHaveBeenCalledWith({
      kubeContext: 'default',
      kubeconfigPath: '/etc/rancher/k3s/k3s.yaml',
      runtimeClassName: 'gvisor',
    });
  });

  it('fails closed and cleans up when the canary is not running under gVisor', async (): Promise<void> => {
    mocks.verifySandbox.mockRejectedValue(new Error('gVisor kernel log was not detected'));
    const { installManagedVmSandboxRuntime } = await import('../src/services/managed-vm-sandbox-runtime.service');

    await expect(installManagedVmSandboxRuntime(artifacts())).rejects.toThrow('gVisor kernel log was not detected');
  });
});

function artifacts(): ManagedVmDownloadedArtifacts {
  return {
    certManagerManifestPath: '/tmp/cert-manager.yaml',
    directory: '/tmp/managed-vm',
    gvisorBinDirectory: '/tmp/gvisor-bin',
    gvisorContainerdShimPath: '/tmp/containerd-shim-runsc-v1',
    gvisorRunscPath: '/tmp/runsc',
    helmPath: '/tmp/helm',
    k3sInstallScriptPath: '/tmp/install-k3s.sh',
    k3sPath: '/tmp/k3s',
  };
}

function success(stdout: string): ManagedVmCommandResult {
  return { exitCode: 0, stderr: '', stdout };
}
