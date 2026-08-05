import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service';

interface ManagedVmClusterMocks {
  chmod: Mock;
  copyFile: Mock;
  execa: Mock;
  mkdir: Mock;
  writeFile: Mock;
}

interface ManagedVmClusterFsMock {
  access: Mock;
  chmod: Mock;
  copyFile: Mock;
  mkdir: Mock;
  readFile: Mock;
  stat: Mock;
  writeFile: Mock;
}

const mocks: ManagedVmClusterMocks = vi.hoisted(
  (): ManagedVmClusterMocks => ({
    chmod: vi.fn(),
    copyFile: vi.fn(),
    execa: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
  }),
);

vi.mock(
  'node:fs/promises',
  (): ManagedVmClusterFsMock => ({
    access: vi.fn(),
    chmod: mocks.chmod,
    copyFile: mocks.copyFile,
    mkdir: mocks.mkdir,
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: mocks.writeFile,
  }),
);

vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: mocks.execa }));
vi.mock(
  '../src/services/managed-vm-state.service',
  (): Record<string, Mock> => ({
    readManagedVmPathIdentity: vi.fn(async (): Promise<undefined> => await Promise.resolve(undefined)),
  }),
);
vi.mock(
  '../src/services/managed-vm-owned-file.service',
  (): Record<string, Mock> => ({
    ensureManagedVmDirectory: vi.fn(async (): Promise<'directory'> => await Promise.resolve('directory')),
    installNewManagedVmFile: vi.fn(async (): Promise<string> => await Promise.resolve('file:0755:test')),
  }),
);

describe('managed VM cluster installation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
  });

  it('allows the K3s installer to provide kubectl', async (): Promise<void> => {
    const { installManagedVmK3s } = await import('../src/services/managed-vm-cluster.service');
    const artifacts: ManagedVmDownloadedArtifacts = {
      certManagerManifestPath: '/tmp/cert-manager.yaml',
      directory: '/tmp/managed-vm',
      gvisorCheckpointGoferPath: '/tmp/checkpointgofer',
      gvisorContainerdShimPath: '/tmp/containerd-shim-runsc-v1',
      gvisorMetricServerPath: '/tmp/metric-server',
      gvisorRunscConfigPath: '/tmp/runsc.toml',
      gvisorRunscPath: '/tmp/runsc',
      helmPath: '/tmp/helm',
      k3sInstallScriptPath: '/tmp/install-k3s.sh',
      k3sPath: '/tmp/k3s',
    };

    await installManagedVmK3s(artifacts);

    expect(mocks.execa).toHaveBeenNthCalledWith(1, '/usr/bin/env', [
      'INSTALL_K3S_SKIP_DOWNLOAD=true',
      'INSTALL_K3S_EXEC=server --config /etc/rancher/k3s/config.yaml',
      '/tmp/install-k3s.sh',
    ]);
  });
});
