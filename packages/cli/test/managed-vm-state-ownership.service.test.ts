import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmProvisionerState } from '../src/services/managed-vm-provisioning.types';

interface FileMocks {
  lstat: Mock;
  readFile: Mock;
  rename: Mock;
  writeFile: Mock;
}

class OwnedPathStats {
  public readonly mode: number = 0o755;
  public constructor(private readonly directory: boolean) {}
  public isDirectory(): boolean {
    return this.directory;
  }
  public isFile(): boolean {
    return !this.directory;
  }
}

const files: FileMocks = vi.hoisted(
  (): FileMocks => ({
    lstat: vi.fn(),
    readFile: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
  }),
);

vi.mock(
  'node:fs/promises',
  (): Record<string, Mock> => ({
    lstat: files.lstat,
    mkdir: vi.fn(),
    open: vi.fn(),
    readFile: files.readFile,
    rename: files.rename,
    stat: vi.fn(),
    unlink: vi.fn(),
    writeFile: files.writeFile,
  }),
);

describe('managed VM recorded file ownership', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    files.lstat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    files.readFile.mockResolvedValue(Buffer.from('verified helm'));
  });

  it('records regular-file content digests and directory ownership after a stage', async (): Promise<void> => {
    files.lstat.mockImplementation(async (path: string): Promise<OwnedPathStats> => {
      await Promise.resolve();
      if (path === '/etc/compartment') {
        return new OwnedPathStats(true);
      }
      if (path === '/usr/local/bin/helm') {
        return new OwnedPathStats(false);
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    const { createManagedVmState, managedVmFileIdentity, persistManagedVmStage } =
      await import('../src/services/managed-vm-state.service');
    const initial: ManagedVmProvisionerState = await createManagedVmState('host\nens3\n');
    const next: ManagedVmProvisionerState = await persistManagedVmStage(initial, 'preparing-host');
    expect(next.ownedFileDigests).toEqual({
      '/etc/compartment': 'directory',
      '/usr/local/bin/helm': managedVmFileIdentity('verified helm', 0o755),
    });
  });

  it('explains how to read root-owned managed state', async (): Promise<void> => {
    files.readFile.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('root-owned; rerun this command with sudo');
  });

  it('rejects invalid persisted stage discriminants', async (): Promise<void> => {
    files.readFile.mockResolvedValueOnce(
      JSON.stringify({
        ...validState(),
        completedStage: 'not-a-stage',
      }),
    );
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('state at /var/lib/compartment/installer/state.json is invalid');
  });

  it('rejects malformed persisted file digests', async (): Promise<void> => {
    files.readFile.mockResolvedValueOnce(JSON.stringify({ ...validState(), ownedFileDigests: { '/etc/config': 42 } }));
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('state at /var/lib/compartment/installer/state.json is invalid');
  });

  it('rejects primitive persisted file digests', async (): Promise<void> => {
    files.readFile.mockResolvedValueOnce(JSON.stringify({ ...validState(), ownedFileDigests: 42 }));
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('state at /var/lib/compartment/installer/state.json is invalid');
  });

  it('rejects unsupported managed-VM release metadata versions', async (): Promise<void> => {
    files.readFile.mockResolvedValueOnce(
      JSON.stringify({
        ...validState(),
        releaseMetadata: { ...validState().releaseMetadata, metadataVersion: 99 },
      }),
    );
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('state at /var/lib/compartment/installer/state.json is invalid');
  });

  it('rejects v3 release metadata without a SHA-512 verified gVisor artifact', async (): Promise<void> => {
    files.readFile.mockResolvedValueOnce(
      JSON.stringify({
        ...validState(),
        releaseMetadata: {
          ...validState().releaseMetadata,
          artifacts: [
            {
              name: 'gvisor',
              sha256: 'a'.repeat(64),
              url: 'https://storage.googleapis.com/gvisor/releases/pool/test/runsc.deb',
              version: 'release-test',
            },
          ],
          metadataVersion: 3,
        },
      }),
    );
    const { readManagedVmState } = await import('../src/services/managed-vm-state.service');

    await expect(readManagedVmState()).rejects.toThrow('state at /var/lib/compartment/installer/state.json is invalid');
  });

  it('preserves the existing trust set so retry rejects an unrelated owned-path mutation', async (): Promise<void> => {
    const contents: Map<string, Buffer> = new Map<string, Buffer>([
      ['/usr/local/bin/helm', Buffer.from('installer helm')],
    ]);
    files.lstat.mockImplementation(async (path: string): Promise<OwnedPathStats> => {
      await Promise.resolve();
      if (contents.has(path)) {
        return new OwnedPathStats(false);
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    files.readFile.mockImplementation(async (path: string): Promise<Buffer> => {
      await Promise.resolve();
      return contents.get(path)!;
    });
    const { assertManagedVmOwnedFileDigests, createManagedVmState, managedVmFileIdentity, persistManagedVmStage } =
      await import('../src/services/managed-vm-state.service');
    const initial: ManagedVmProvisionerState = await createManagedVmState('host\nens3\n');
    const prepared: ManagedVmProvisionerState = await persistManagedVmStage(initial, 'preparing-host');

    contents.set('/usr/local/bin/runsc', Buffer.from('installer runsc'));
    contents.set('/usr/local/bin/helm', Buffer.from('concurrent helm change'));
    const resumed: ManagedVmProvisionerState = await persistManagedVmStage(prepared, 'installing-sandbox-runtime');

    expect(resumed.ownedFileDigests).toMatchObject({
      '/usr/local/bin/helm': managedVmFileIdentity('installer helm', 0o755),
      '/usr/local/bin/runsc': managedVmFileIdentity('installer runsc', 0o755),
    });

    await expect(assertManagedVmOwnedFileDigests(resumed)).rejects.toThrow(
      'owned host content has changed; refusing to overwrite or remove it',
    );
  });

  it('rejects installer-written bytes that change before stage ownership is persisted', async (): Promise<void> => {
    files.lstat.mockImplementation(async (path: string): Promise<OwnedPathStats> => {
      await Promise.resolve();
      if (path === '/usr/local/bin/runsc') {
        return new OwnedPathStats(false);
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    files.readFile.mockResolvedValue(Buffer.from('changed runsc'));
    const { createManagedVmState, managedVmFileIdentity, persistManagedVmStage } =
      await import('../src/services/managed-vm-state.service');
    const initial: ManagedVmProvisionerState = await createManagedVmState('host\nens3\n');

    await expect(
      persistManagedVmStage(initial, 'installing-sandbox-runtime', {
        '/usr/local/bin/runsc': managedVmFileIdentity('verified runsc', 0o755),
      }),
    ).rejects.toThrow('installer-written content changed before ownership could be persisted');
  });
});

function validState(): ManagedVmProvisionerState {
  return {
    completedStage: 'pending',
    configDigest: 'config',
    installationId: 'install-123',
    metadataDigest: 'metadata',
    ownedFileDigests: {},
    ownedPaths: [],
    releaseMetadata: {
      artifacts: [],
      certManagerVersion: 'v1',
      gvisorVersion: 'release-test',
      helmVersion: 'v1',
      k3sChannel: 'stable',
      k3sVersion: 'v1',
      kubernetesMinor: '1.35',
      metadataVersion: 2,
      podCidr: `10.${String(42)}.0.0/16`,
      serviceCidr: `10.${String(43)}.0.0/16`,
    },
    resolvedArtifacts: [],
    startedAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  };
}
