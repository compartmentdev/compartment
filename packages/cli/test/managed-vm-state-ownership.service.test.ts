import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmProvisionerState } from '../src/services/managed-vm-provisioning.types';

interface FileMocks {
  lstat: Mock;
  open: Mock;
  readFile: Mock;
  rename: Mock;
  writeFile: Mock;
}

class OwnedPathStats {
  public readonly gid: number = 0;
  public readonly uid: number = 0;
  public constructor(
    private readonly directory: boolean,
    public readonly mode: number = 0o755,
  ) {}
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
    open: vi.fn(),
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
    open: files.open,
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
    files.open.mockResolvedValue({
      close: async (): Promise<void> => await Promise.resolve(),
      sync: async (): Promise<void> => await Promise.resolve(),
      writeFile: async (): Promise<void> => await Promise.resolve(),
    });
    files.readFile.mockResolvedValue(Buffer.from('verified helm'));
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
    const created: ManagedVmProvisionerState = await createManagedVmState('host\nens3\n');
    const initial: ManagedVmProvisionerState = {
      ...created,
      ownedPaths: [{ path: '/usr/local/bin/runsc', stage: 'installing-sandbox-runtime' }],
    };

    await expect(
      persistManagedVmStage(initial, 'installing-sandbox-runtime', {
        '/usr/local/bin/runsc': managedVmFileIdentity('verified runsc', 0o755),
      }),
    ).rejects.toThrow('installer-written content changed before ownership could be persisted');
  });

  it('retains the prior digest and rejects an unrelated owned-path change after a failed stage mutation', async (): Promise<void> => {
    files.lstat.mockImplementation(async (path: string): Promise<OwnedPathStats> => {
      await Promise.resolve();
      if (path === '/usr/local/bin/helm' || path === '/usr/local/bin/k3s') {
        return new OwnedPathStats(false);
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    files.readFile.mockImplementation(async (path: string): Promise<Buffer> => {
      await Promise.resolve();
      return Buffer.from(path === '/usr/local/bin/helm' ? 'concurrent helm change' : 'verified k3s');
    });
    const { managedVmFileIdentity, persistManagedVmStage } = await import('../src/services/managed-vm-state.service');
    const state: ManagedVmProvisionerState = {
      ...validState(),
      completedStage: 'preparing-host',
      ownedFileDigests: { '/usr/local/bin/helm': managedVmFileIdentity('verified helm', 0o755) },
      ownedPaths: [
        { path: '/usr/local/bin/helm', stage: 'preparing-host' },
        { path: '/usr/local/bin/k3s', stage: 'installing-k3s' },
      ],
      releaseMetadata: { ...validState().releaseMetadata, gvisorVersion: 'release-test', metadataVersion: 3 },
    };

    await expect(
      persistManagedVmStage(state, 'installing-k3s', {
        '/usr/local/bin/k3s': managedVmFileIdentity('verified k3s', 0o755),
      }),
    ).rejects.toThrow('owned host content has changed; refusing to overwrite or remove it');
    expect(state.ownedFileDigests).toEqual({
      '/usr/local/bin/helm': managedVmFileIdentity('verified helm', 0o755),
    });
  });

  it('names each drifted path and what changed about it', async (): Promise<void> => {
    files.lstat.mockImplementation(async (path: string): Promise<OwnedPathStats> => {
      await Promise.resolve();
      if (path === '/etc/compartment/firewall.nft') {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return new OwnedPathStats(false, path === '/etc/containerd/runsc.toml' ? 0o644 : 0o755);
    });
    files.readFile.mockImplementation(async (path: string): Promise<Buffer> => {
      await Promise.resolve();
      return Buffer.from(path === '/usr/local/bin/helm' ? 'helm v4.2.3' : 'installer content');
    });
    const { assertManagedVmOwnedFileDigests, managedVmFileIdentity } =
      await import('../src/services/managed-vm-state.service');
    const state: ManagedVmProvisionerState = {
      ...validState(),
      completedStage: 'preparing-host',
      ownedFileDigests: {
        '/etc/compartment/firewall.nft': managedVmFileIdentity('installer content', 0o755),
        '/etc/containerd/runsc.toml': managedVmFileIdentity('installer content', 0o600),
        '/usr/local/bin/helm': managedVmFileIdentity('helm v4.1.4', 0o755),
      },
      ownedPaths: [
        { path: '/etc/compartment/firewall.nft', stage: 'preparing-host' },
        { path: '/etc/containerd/runsc.toml', stage: 'preparing-host' },
        { path: '/usr/local/bin/helm', stage: 'preparing-host' },
      ],
      releaseMetadata: { ...validState().releaseMetadata, gvisorVersion: 'release-test', metadataVersion: 3 },
    };

    const failure: Error = await assertManagedVmOwnedFileDigests(state).then(
      (): Error => new Error('expected drift to be reported'),
      (error: Error): Error => error,
    );

    expect(failure.message).toContain('/etc/containerd/runsc.toml: mode changed from 0600 to 0644');
    expect(failure.message).toContain('/usr/local/bin/helm: content changed');
    expect(failure.message).toContain('/etc/compartment/firewall.nft: missing from the host');
    expect(failure.message).toContain('/var/lib/compartment/installer/state.json');
    expect(failure.message).toContain('compartment system diagnose');
  });

  it('rejects an ownership or mode change to an installer-owned directory', async (): Promise<void> => {
    files.lstat.mockResolvedValue(new OwnedPathStats(true, 0o755));
    const { assertManagedVmOwnedFileDigests, managedVmDirectoryIdentity } =
      await import('../src/services/managed-vm-state.service');
    const state: ManagedVmProvisionerState = {
      ...validState(),
      completedStage: 'preparing-host',
      ownedFileDigests: {
        '/etc/compartment': managedVmDirectoryIdentity({ gid: 0, mode: 0o700, uid: 0 }),
      },
      ownedPaths: [{ path: '/etc/compartment', stage: 'preparing-host' }],
      releaseMetadata: { ...validState().releaseMetadata, gvisorVersion: 'release-test', metadataVersion: 3 },
    };

    await expect(assertManagedVmOwnedFileDigests(state)).rejects.toThrow(
      'owned host content has changed; refusing to overwrite or remove it',
    );
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
