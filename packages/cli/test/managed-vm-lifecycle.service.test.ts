import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmProvisionerState, ManagedVmUpdateState } from '../src/services/managed-vm-provisioning.types';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';
import type * as ManagedVmStateService from '../src/services/managed-vm-state.service';
import { managedVmOwnedPaths } from '../src/services/managed-vm-state.service';

type ImportOriginalManagedVmStateService = () => Promise<typeof ManagedVmStateService>;

interface LifecycleMocks {
  acquireLock: Mock;
  assertFileOwnership: Mock;
  completeBuildRuntimeMigration: Mock;
  completeUpdate: Mock;
  digest: Mock;
  execa: Mock;
  persistUpdate: Mock;
  prepareBuildRuntimeMigration: Mock;
  readState: Mock;
  verifyComponents: Mock;
  verifySandbox: Mock;
}

const mocks: LifecycleMocks = vi.hoisted(
  (): LifecycleMocks => ({
    acquireLock: vi.fn(),
    assertFileOwnership: vi.fn(),
    completeBuildRuntimeMigration: vi.fn(),
    completeUpdate: vi.fn(),
    digest: vi.fn(),
    execa: vi.fn(),
    persistUpdate: vi.fn(),
    prepareBuildRuntimeMigration: vi.fn(),
    readState: vi.fn(),
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
  (): Record<string, Mock> => ({ verifyManagedVmSandboxRuntime: mocks.verifySandbox }),
);
vi.mock(
  '../src/services/managed-vm-build-runtime-migration.service',
  (): Record<string, Mock> => ({
    completeManagedVmBuildRuntimeMigration: mocks.completeBuildRuntimeMigration,
    prepareManagedVmBuildRuntimeMigration: mocks.prepareBuildRuntimeMigration,
  }),
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
    mocks.readState.mockResolvedValue(state);
    mocks.digest.mockImplementation((value: string): string =>
      value.includes('"metadataVersion":4') || value.includes('"metadataVersion":5') ? 'previous-metadata' : 'metadata',
    );
    mocks.persistUpdate.mockImplementation(
      async (current: ManagedVmProvisionerState, update: ManagedVmUpdateState): Promise<ManagedVmProvisionerState> =>
        await Promise.resolve({ ...current, update }),
    );
    mocks.prepareBuildRuntimeMigration.mockResolvedValue(false);
    mocks.completeBuildRuntimeMigration.mockImplementation(
      async (current: ManagedVmProvisionerState): Promise<ManagedVmProvisionerState> =>
        await Promise.resolve({
          ...current,
          metadataDigest: 'metadata',
          ownedPaths: managedVmOwnedPaths,
          releaseMetadata: managedVmReleaseMetadata,
          resolvedArtifacts: managedVmReleaseMetadata.artifacts,
        }),
    );
    mocks.completeUpdate.mockImplementation(
      async (current: ManagedVmProvisionerState, update: ManagedVmUpdateState): Promise<ManagedVmProvisionerState> =>
        await Promise.resolve({ ...current, update }),
    );
    mocks.acquireLock.mockResolvedValue(async (): Promise<void> => {
      await Promise.resolve();
    });
  });

  it('fails closed when managed state exists but is malformed', async (): Promise<void> => {
    mocks.readState.mockRejectedValue(new Error('Managed-VM state is invalid.'));
    const { hasManagedVmInstallation } = await import('../src/services/managed-vm-installation.service');
    await expect(hasManagedVmInstallation()).rejects.toThrow('state is invalid');
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

  it('installs and records the build runtime before updating a metadata-v5 platform', async (): Promise<void> => {
    const previousMetadata = { ...managedVmReleaseMetadata, metadataVersion: 5 as const };
    mocks.readState.mockResolvedValue({
      ...state,
      metadataDigest: 'previous-metadata',
      ownedPaths: managedVmOwnedPaths.filter((ownedPath): boolean => !ownedPath.path.endsWith('/runsc-build.toml')),
      releaseMetadata: previousMetadata,
      resolvedArtifacts: previousMetadata.artifacts,
    });
    mocks.prepareBuildRuntimeMigration.mockResolvedValue(true);
    const updatePlatform: Mock = vi.fn().mockResolvedValue('updated result');
    const { updateManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(updatePlatform, vi.fn())).resolves.toBe('updated result');
    expect(mocks.completeBuildRuntimeMigration).toHaveBeenCalledOnce();
    expect(mocks.completeBuildRuntimeMigration.mock.invocationCallOrder[0]).toBeLessThan(
      updatePlatform.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects update for an older untrusted runtime state', async (): Promise<void> => {
    const previousState: ManagedVmProvisionerState = {
      ...state,
      metadataDigest: 'previous-metadata',
      ownedPaths: managedVmOwnedPaths,
      releaseMetadata: { ...managedVmReleaseMetadata, metadataVersion: 4 },
    };
    mocks.readState.mockResolvedValue(previousState);
    const updatePlatform: Mock = vi.fn();
    const { updateManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(updatePlatform, vi.fn())).rejects.toThrow('Reprovision the VM');
    expect(updatePlatform).not.toHaveBeenCalled();
  });

  it('rejects a retry when an unrelated owned path changes during a failed platform update', async (): Promise<void> => {
    let ownedPathChanged: boolean = false;
    mocks.assertFileOwnership.mockImplementation(async (): Promise<void> => {
      await Promise.resolve();
      if (ownedPathChanged) {
        throw new Error('Managed-VM owned host content has changed; refusing to overwrite or remove it.');
      }
    });
    const failedPlatformUpdate: () => Promise<string> = async (): Promise<string> => {
      await Promise.resolve();
      ownedPathChanged = true;
      throw new Error('Helm update failed');
    };
    const unexpectedPlatformUpdate: () => Promise<string> = async (): Promise<string> =>
      await Promise.resolve('unexpected');
    const { updateManagedVmInstallation } = await import('../src/services/managed-vm-lifecycle.service');

    await expect(updateManagedVmInstallation(failedPlatformUpdate, vi.fn())).rejects.toThrow('Helm update failed');
    await expect(updateManagedVmInstallation(unexpectedPlatformUpdate, vi.fn())).rejects.toThrow(
      'owned host content has changed; refusing to overwrite or remove it',
    );
  });
});
