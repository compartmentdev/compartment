import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedVmReleaseMetadata } from '../src/services/managed-vm-release-metadata.service';
import { managedVmFileIdentity, managedVmOwnedPaths } from '../src/services/managed-vm-state.service';
import type { ManagedVmDownloadedArtifacts } from '../src/services/managed-vm-artifacts.service.types';
import type { ManagedVmProvisionerState } from '../src/services/managed-vm-provisioning.types';

type GetUid = () => number;

afterEach((): void => {
  vi.doUnmock('node:fs/promises');
  vi.doUnmock('../src/sea');
  vi.doUnmock('../src/services/managed-vm-artifacts.service');
  vi.doUnmock('../src/services/managed-vm-lock.service');
  vi.resetModules();
});

describe('managed VM provisioner runtime boundary', (): void => {
  it('rejects a source CLI before entering host provisioning', async (): Promise<void> => {
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    process.getuid = (): number => 0;
    try {
      const { provisionManagedVmCluster } = await import('../src/services/managed-vm-provisioner.service');
      await expect(
        provisionManagedVmCluster({
          publicAddress: `203.0.${String(113)}.10`,
          publicInterface: 'ens3',
          reportStage: (): void => {
            throw new Error('A source CLI must not enter a mutation stage.');
          },
        }),
      ).rejects.toThrow('verified packaged Compartment CLI');
    } finally {
      process.getuid = getuid;
    }
  });

  it('rejects a resumed install before its next mutation when an owned file changed', async (): Promise<void> => {
    vi.resetModules();
    const getuid: GetUid | undefined = process.getuid;
    if (getuid === undefined) {
      throw new Error('This test requires process.getuid.');
    }
    const state: ManagedVmProvisionerState = resumedState();
    vi.doMock('../src/sea', (): { isSeaRuntime: () => boolean } => ({ isSeaRuntime: (): boolean => true }));
    vi.doMock(
      '../src/services/managed-vm-artifacts.service',
      (): {
        cleanManagedVmArtifacts: () => Promise<void>;
        downloadManagedVmArtifacts: () => Promise<ManagedVmDownloadedArtifacts>;
      } => ({
        cleanManagedVmArtifacts: async (): Promise<void> => await Promise.resolve(),
        downloadManagedVmArtifacts: async (): Promise<ManagedVmDownloadedArtifacts> =>
          await Promise.resolve({ directory: '/tmp/test' } as ManagedVmDownloadedArtifacts),
      }),
    );
    vi.doMock(
      '../src/services/managed-vm-lock.service',
      (): { acquireManagedVmLock: () => Promise<() => Promise<void>> } => ({
        acquireManagedVmLock: async (): Promise<() => Promise<void>> =>
          await Promise.resolve(async (): Promise<void> => await Promise.resolve()),
      }),
    );
    vi.doMock('node:fs/promises', async (importOriginal: () => Promise<object>): Promise<object> => {
      const actual: object = await importOriginal();
      return {
        ...actual,
        lstat: async (path: string): Promise<object> => {
          await Promise.resolve();
          if (path === '/usr/local/bin/helm') {
            return { isDirectory: (): boolean => false, isFile: (): boolean => true };
          }
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
        readFile: async (path: string): Promise<string | Buffer> =>
          path === '/var/lib/compartment/installer/state.json'
            ? await Promise.resolve(JSON.stringify(state))
            : await Promise.resolve(Buffer.from('concurrent helm change')),
      };
    });
    process.getuid = (): number => 0;
    try {
      const { provisionManagedVmCluster } = await import('../src/services/managed-vm-provisioner.service');
      await expect(
        provisionManagedVmCluster({
          publicAddress: `203.0.${String(113)}.10`,
          publicInterface: 'ens3',
          reportStage: (): void => {
            throw new Error('Provisioning reached a mutation stage.');
          },
        }),
      ).rejects.toThrow('owned host content has changed; refusing to overwrite or remove it');
    } finally {
      process.getuid = getuid;
    }
  });
});

function resumedState(): ManagedVmProvisionerState {
  const config: string = `203.0.${String(113)}.10\nens3\n`;
  return {
    completedStage: 'preparing-host',
    configDigest: digest(config),
    installationId: 'install-123',
    metadataDigest: digest(JSON.stringify(managedVmReleaseMetadata)),
    ownedFileDigests: { '/usr/local/bin/helm': managedVmFileIdentity('installer helm', 0o755) },
    ownedPaths: managedVmOwnedPaths,
    releaseMetadata: managedVmReleaseMetadata,
    resolvedArtifacts: managedVmReleaseMetadata.artifacts,
    startedAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  };
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
