import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmOwnedPath, ManagedVmProvisionerState } from '../src/services/managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';

interface LifecycleMocks {
  acquireLock: Mock;
  assertFileOwnership: Mock;
  execa: Mock;
  lstat: Mock;
  readState: Mock;
  removeFirewall: Mock;
  rm: Mock;
  rmdir: Mock;
}

const mocks: LifecycleMocks = vi.hoisted(
  (): LifecycleMocks => ({
    acquireLock: vi.fn(),
    assertFileOwnership: vi.fn(),
    execa: vi.fn(),
    lstat: vi.fn(),
    readState: vi.fn(),
    removeFirewall: vi.fn(),
    rm: vi.fn(),
    rmdir: vi.fn(),
  }),
);

const ownedPaths: readonly ManagedVmOwnedPath[] = [
  { path: '/etc/compartment', stage: 'preparing-host' },
  { path: '/usr/local/bin/k3s-uninstall.sh', stage: 'installing-k3s' },
];
const state: ManagedVmProvisionerState = {
  completedStage: 'complete',
  configDigest: 'config',
  installationId: 'install-123',
  metadataDigest: 'metadata',
  ownedFileDigests: {},
  ownedPaths,
  releaseMetadata: managedVmReleaseMetadata,
  resolvedArtifacts: managedVmReleaseMetadata.artifacts,
  startedAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

vi.mock(
  'node:fs/promises',
  (): Record<string, Mock> => ({
    access: vi.fn(),
    lstat: mocks.lstat,
    mkdtemp: vi.fn(),
    rm: mocks.rm,
    rmdir: mocks.rmdir,
    writeFile: vi.fn(),
  }),
);
vi.mock('../src/services/managed-vm-command.service', (): Record<string, Mock> => ({ execa: mocks.execa }));
vi.mock(
  '../src/services/managed-vm-lock.service',
  (): Record<string, Mock> => ({
    acquireManagedVmLock: mocks.acquireLock,
  }),
);
vi.mock(
  '../src/services/managed-vm-firewall.service',
  (): Record<string, Mock> => ({ removeManagedVmFirewall: mocks.removeFirewall }),
);
vi.mock(
  '../src/services/managed-vm-state.service',
  (): Record<string, Mock | string | readonly ManagedVmOwnedPath[]> => ({
    assertManagedVmOwnedFileDigests: mocks.assertFileOwnership,
    completeManagedVmReleaseUpdate: vi.fn(),
    digest: vi.fn((): string => 'metadata'),
    managedVmOwnedPaths: ownedPaths,
    managedVmStateDirectory: '/var/lib/compartment/installer',
    managedVmStatePath: '/var/lib/compartment/installer/state.json',
    persistManagedVmUpdate: vi.fn(),
    recordManagedVmOwnedFileDigests: vi.fn(),
    readManagedVmState: mocks.readState,
  }),
);

describe('managed VM lifecycle ownership', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.execa.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    mocks.rmdir.mockResolvedValue(undefined);
    mocks.lstat.mockImplementation(async (path: string): Promise<{ isDirectory: () => boolean }> => {
      await Promise.resolve();
      return { isDirectory: (): boolean => path === '/etc/compartment' };
    });
    mocks.readState.mockResolvedValue(state);
    mocks.acquireLock.mockResolvedValue(async (): Promise<void> => {
      await Promise.resolve();
    });
  });

  it('uses the upstream uninstall and removes only manifest-owned paths', async (): Promise<void> => {
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');
    await resetManagedVmInstallation({ confirmation: state.installationId });

    expect(mocks.execa).toHaveBeenCalledWith('/usr/local/bin/k3s-uninstall.sh', []);
    expect(mocks.rmdir).toHaveBeenCalledWith('/etc/compartment');
    expect(mocks.rm).not.toHaveBeenCalledWith('/etc/compartment', expect.anything());
    expect(mocks.rm).not.toHaveBeenCalledWith('/usr/local/bin/helm', expect.anything());
    expect(mocks.acquireLock).toHaveBeenCalledOnce();
  });

  it('refuses to recursively remove a managed directory containing unexpected content', async (): Promise<void> => {
    mocks.rmdir.mockRejectedValue(Object.assign(new Error('not empty'), { code: 'ENOTEMPTY' }));
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');
    await expect(resetManagedVmInstallation({ confirmation: state.installationId })).rejects.toThrow('not empty');
    expect(mocks.rm).not.toHaveBeenCalledWith('/etc/compartment', expect.objectContaining({ recursive: true }));
  });

  it('refuses reset when the exact installation ID is not provided', async (): Promise<void> => {
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');
    await expect(resetManagedVmInstallation({ confirmation: 'wrong' })).rejects.toThrow('exact installation ID');
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it('fails closed when managed state exists but is malformed', async (): Promise<void> => {
    mocks.readState.mockRejectedValue(new Error('Managed-VM state is invalid.'));
    const { hasManagedVmInstallation } = await import('../src/services/managed-vm-installation.service');
    await expect(hasManagedVmInstallation()).rejects.toThrow('state is invalid');
  });

  it('refuses reset when release artifact ownership differs', async (): Promise<void> => {
    mocks.readState.mockResolvedValue({ ...state, resolvedArtifacts: [] });
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');
    await expect(resetManagedVmInstallation({ confirmation: state.installationId })).rejects.toThrow(
      'release ownership metadata',
    );
    expect(mocks.removeFirewall).not.toHaveBeenCalled();
  });

  it('refuses reset when recorded owned file content no longer matches', async (): Promise<void> => {
    mocks.assertFileOwnership.mockRejectedValue(new Error('owned host content has changed'));
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');
    await expect(resetManagedVmInstallation({ confirmation: state.installationId })).rejects.toThrow(
      'owned host content has changed',
    );
    expect(mocks.removeFirewall).not.toHaveBeenCalled();
  });
});
