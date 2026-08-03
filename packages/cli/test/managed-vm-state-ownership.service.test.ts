import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManagedVmProvisionerState } from '../src/services/managed-vm-provisioning.types';

interface FileMocks {
  lstat: Mock;
  readFile: Mock;
  rename: Mock;
  writeFile: Mock;
}

class OwnedPathStats {
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
    const { createManagedVmState, digest, persistManagedVmStage } =
      await import('../src/services/managed-vm-state.service');
    const initial: ManagedVmProvisionerState = await createManagedVmState('host\nens3\n');
    const next: ManagedVmProvisionerState = await persistManagedVmStage(initial, 'preparing-host');
    expect(next.ownedFileDigests).toEqual({
      '/etc/compartment': 'directory',
      '/usr/local/bin/helm': digest('verified helm'),
    });
  });
});
