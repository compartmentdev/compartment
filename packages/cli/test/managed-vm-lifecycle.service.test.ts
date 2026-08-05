import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmProvisionerState, ManagedVmUpdateState } from '../src/services/managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';
import type * as ManagedVmStateService from '../src/services/managed-vm-state.service';
import { managedVmOwnedPaths, managedVmPreviousOwnedPaths } from '../src/services/managed-vm-state.service';

type ImportOriginalManagedVmStateService = () => Promise<typeof ManagedVmStateService>;

interface LifecycleMocks {
  acquireLock: Mock;
  assertFileOwnership: Mock;
  completeUpdate: Mock;
  digest: Mock;
  execa: Mock;
  lstat: Mock;
  persistUpdate: Mock;
  readState: Mock;
  readdir: Mock;
  removeFirewall: Mock;
  rm: Mock;
  rmdir: Mock;
  verifyComponents: Mock;
  verifySandbox: Mock;
}

const mocks: LifecycleMocks = vi.hoisted(
  (): LifecycleMocks => ({
    acquireLock: vi.fn(),
    assertFileOwnership: vi.fn(),
    completeUpdate: vi.fn(),
    digest: vi.fn(),
    execa: vi.fn(),
    lstat: vi.fn(),
    persistUpdate: vi.fn(),
    readState: vi.fn(),
    readdir: vi.fn(),
    removeFirewall: vi.fn(),
    rm: vi.fn(),
    rmdir: vi.fn(),
    verifyComponents: vi.fn(),
    verifySandbox: vi.fn(),
  }),
);

const state: ManagedVmProvisionerState = {
  completedStage: 'complete',
  configDigest: 'config',
  installationId: 'install-123',
  metadataDigest: 'metadata',
  ownedFileDigests: {},
  ownedPaths: managedVmOwnedPaths,
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
    readdir: mocks.readdir,
    rm: mocks.rm,
    rmdir: mocks.rmdir,
    writeFile: vi.fn(),
  }),
);
vi.mock('../src/services/managed-vm-command.service', (): Record<string, Mock> => ({ execa: mocks.execa }));
vi.mock(
  '../src/services/managed-vm-cluster.service',
  (): Record<string, Mock> => ({
    verifyManagedVmComponentVersions: mocks.verifyComponents,
  }),
);
vi.mock(
  '../src/services/managed-vm-lock.service',
  (): Record<string, Mock> => ({
    acquireManagedVmLock: mocks.acquireLock,
  }),
);
vi.mock(
  '../src/services/managed-vm-sandbox-runtime.service',
  (): Record<string, Mock> => ({
    verifyManagedVmSandboxRuntime: mocks.verifySandbox,
  }),
);
vi.mock(
  '../src/services/managed-vm-firewall.service',
  (): Record<string, Mock> => ({ removeManagedVmFirewall: mocks.removeFirewall }),
);
vi.mock(
  '../src/services/managed-vm-state.service',
  async (importOriginal: ImportOriginalManagedVmStateService): Promise<typeof ManagedVmStateService> => {
    const actual: typeof ManagedVmStateService = await importOriginal();
    return {
      ...actual,
      assertManagedVmOwnedFileDigests: mocks.assertFileOwnership,
      completeManagedVmReleaseUpdate: mocks.completeUpdate,
      digest: mocks.digest,
      persistManagedVmUpdate: mocks.persistUpdate,
      readManagedVmState: mocks.readState,
    };
  },
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
    mocks.readdir.mockResolvedValue([
      { isFile: (): boolean => true, name: 'checkpointgofer' },
      { isFile: (): boolean => true, name: 'runsc-metric-server' },
    ]);
    mocks.digest.mockImplementation((value: string): string =>
      value.includes('"metadataVersion":2') ? 'previous-metadata' : 'metadata',
    );
    mocks.persistUpdate.mockImplementation(
      async (current: ManagedVmProvisionerState, update: ManagedVmUpdateState): Promise<ManagedVmProvisionerState> =>
        await Promise.resolve({ ...current, update }),
    );
    mocks.completeUpdate.mockImplementation(
      async (current: ManagedVmProvisionerState, update: ManagedVmUpdateState): Promise<ManagedVmProvisionerState> =>
        await Promise.resolve({ ...current, update }),
    );
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

  it('reports unavailable when k3s version lookup fails', async (): Promise<void> => {
    mocks.execa
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: 'active\n' })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'missing', stdout: '' });
    const { getManagedVmSystemStatus } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(getManagedVmSystemStatus()).resolves.toMatchObject({ k3sVersion: 'unavailable' });
  });

  it('resumes after the platform update without repeating the platform mutation', async (): Promise<void> => {
    mocks.readState.mockResolvedValue({
      ...state,
      update: {
        metadataDigest: 'metadata',
        snapshotName: 'snapshot-1',
        stage: 'platform-updated',
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
      },
    });
    const updatePlatform: Mock = vi.fn();
    const readPlatformResult: Mock = vi.fn().mockResolvedValue('existing result');
    const { updateManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(updatePlatform, readPlatformResult)).resolves.toBe('existing result');
    expect(updatePlatform).not.toHaveBeenCalled();
    expect(readPlatformResult).toHaveBeenCalledOnce();
    expect(mocks.completeUpdate).toHaveBeenCalledOnce();
  });

  it('resumes after the snapshot without creating another snapshot', async (): Promise<void> => {
    mocks.readState.mockResolvedValue({
      ...state,
      update: {
        metadataDigest: 'metadata',
        snapshotName: 'snapshot-1',
        stage: 'snapshot-created',
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
      },
    });
    const updatePlatform: Mock = vi.fn().mockResolvedValue('updated result');
    const readPlatformResult: Mock = vi.fn();
    const { updateManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(updatePlatform, readPlatformResult)).resolves.toBe('updated result');
    expect(mocks.execa).not.toHaveBeenCalledWith('k3s', expect.arrayContaining(['etcd-snapshot']), expect.anything());
    expect(updatePlatform).toHaveBeenCalledOnce();
    expect(readPlatformResult).not.toHaveBeenCalled();
  });

  it('rejects an older runtime update and permits its explicit reset', async (): Promise<void> => {
    const previousState: ManagedVmProvisionerState = {
      ...state,
      metadataDigest: 'previous-metadata',
      ownedPaths: managedVmPreviousOwnedPaths,
      releaseMetadata: { ...managedVmReleaseMetadata, metadataVersion: 2 },
    };
    mocks.readState.mockResolvedValue(previousState);
    const updatePlatform: Mock = vi.fn();
    const { resetManagedVmInstallation, updateManagedVmInstallation } =
      await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(updatePlatform, vi.fn())).rejects.toThrow('Reset and reinstall');
    expect(updatePlatform).not.toHaveBeenCalled();
    await expect(resetManagedVmInstallation({ confirmation: previousState.installationId })).resolves.toBeUndefined();
  });

  it('refuses a historical reset before mutation when the legacy helper directory has unexpected content', async (): Promise<void> => {
    const previousState: ManagedVmProvisionerState = {
      ...state,
      metadataDigest: 'previous-metadata',
      ownedPaths: managedVmPreviousOwnedPaths,
      releaseMetadata: { ...managedVmReleaseMetadata, metadataVersion: 2 },
    };
    mocks.readState.mockResolvedValue(previousState);
    mocks.readdir.mockResolvedValue([
      { isFile: (): boolean => true, name: 'checkpointgofer' },
      { isFile: (): boolean => true, name: 'operator-file' },
      { isFile: (): boolean => true, name: 'runsc-metric-server' },
    ]);
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(resetManagedVmInstallation({ confirmation: previousState.installationId })).rejects.toThrow(
      'unexpected content in the gVisor helper directory',
    );
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it('refuses a current reset before mutation when the helper directory has unexpected content', async (): Promise<void> => {
    mocks.readdir.mockResolvedValue([
      { isFile: (): boolean => true, name: 'checkpointgofer' },
      { isFile: (): boolean => true, name: 'operator-file' },
      { isFile: (): boolean => true, name: 'runsc-metric-server' },
    ]);
    const { resetManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(resetManagedVmInstallation({ confirmation: state.installationId })).rejects.toThrow(
      'unexpected content in the gVisor helper directory',
    );
    expect(mocks.execa).not.toHaveBeenCalled();
  });
});
