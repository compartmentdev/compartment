import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parse } from 'yaml';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service';

interface ManagedVmClusterMocks {
  chmod: Mock;
  copyFile: Mock;
  execa: Mock;
  mkdir: Mock;
  installNewManagedVmFile: Mock;
  readManagedVmPathIdentity: Mock;
  writeFile: Mock;
}

interface ManagedVmClusterFsMock {
  access: Mock;
  chmod: Mock;
  copyFile: Mock;
  mkdir: Mock;
  mkdtemp: Mock;
  readFile: Mock;
  rm: Mock;
  stat: Mock;
  writeFile: Mock;
}

type ManagedVmInstalledFileCall = [path: string, content: string | Buffer, mode: number];

const mocks: ManagedVmClusterMocks = vi.hoisted(
  (): ManagedVmClusterMocks => ({
    chmod: vi.fn(),
    copyFile: vi.fn(),
    execa: vi.fn(),
    mkdir: vi.fn(),
    installNewManagedVmFile: vi.fn(async (): Promise<string> => await Promise.resolve('file:0755:test')),
    readManagedVmPathIdentity: vi.fn(),
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
    mkdtemp: vi.fn(async (): Promise<string> => await Promise.resolve('/tmp/managed-vm-test')),
    readFile: vi.fn(async (): Promise<Buffer> => await Promise.resolve(Buffer.from('test'))),
    rm: vi.fn(),
    stat: vi.fn(),
    writeFile: mocks.writeFile,
  }),
);

vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: mocks.execa }));
vi.mock(
  '../src/services/managed-vm-state.service',
  (): Record<string, Mock> => ({
    readManagedVmPathIdentity: mocks.readManagedVmPathIdentity,
  }),
);
vi.mock(
  '../src/services/managed-vm-owned-file.service',
  (): Record<string, Mock> => ({
    ensureManagedVmDirectory: vi.fn(async (): Promise<'directory'> => await Promise.resolve('directory')),
    installNewManagedVmFile: mocks.installNewManagedVmFile,
  }),
);

describe('managed VM cluster installation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    mocks.readManagedVmPathIdentity.mockResolvedValue('file:0755:generated');
  });

  it('installs K3s node allocatable reservations and hard eviction headroom', async (): Promise<void> => {
    const { prepareManagedVmHost } = await import('../src/services/managed-vm-cluster.service');
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

    await prepareManagedVmHost(artifacts, '203.0.113.10');

    const configCall: ManagedVmInstalledFileCall | undefined = mocks.installNewManagedVmFile.mock.calls.find(
      (call): boolean => call[0] === '/etc/rancher/k3s/config.yaml',
    ) as ManagedVmInstalledFileCall | undefined;
    expect(configCall).toBeDefined();
    expect(parse(String(configCall?.[1]))).toEqual({
      'cluster-init': true,
      'secrets-encryption': true,
      'write-kubeconfig-mode': '0600',
      'node-external-ip': '203.0.113.10',
      'node-label': ['compartment.dev/node-pool=data'],
      'etcd-snapshot-schedule-cron': '0 */12 * * *',
      'etcd-snapshot-retention': 5,
      'kubelet-arg': [
        'system-reserved=memory=512Mi',
        'kube-reserved=memory=512Mi',
        'eviction-hard=memory.available<512Mi,nodefs.available<10%,imagefs.available<15%,nodefs.inodesFree<5%,imagefs.inodesFree<5%',
      ],
    });
    expect(configCall?.[2]).toBe(0o600);
    const valuesCall: ManagedVmInstalledFileCall | undefined = mocks.installNewManagedVmFile.mock.calls.find(
      (call): boolean => call[0] === '/etc/compartment/values.yaml',
    ) as ManagedVmInstalledFileCall | undefined;
    expect(parse(String(valuesCall?.[1]))).toMatchObject({
      nodePools: {
        data: {
          nodeSelector: { 'compartment.dev/node-pool': 'data' },
          tolerations: [],
        },
      },
    });
  });

  it('accepts a complete K3s-owned file inventory', async (): Promise<void> => {
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

    await expect(installManagedVmK3s(artifacts)).resolves.toBeDefined();
  });

  it('fails closed when the K3s installer omits a required owned path', async (): Promise<void> => {
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
    mocks.readManagedVmPathIdentity.mockImplementation(async (path: string): Promise<string | undefined> => {
      await Promise.resolve();
      return path === '/etc/systemd/system/k3s.service.env' ? undefined : 'file:0755:generated';
    });

    await expect(installManagedVmK3s(artifacts)).rejects.toThrow(
      'K3s installer did not create the required owned path at /etc/systemd/system/k3s.service.env',
    );
  });
});
