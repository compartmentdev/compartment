import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

interface LockHandle {
  close: Mock;
  stat: Mock;
  writeFile: Mock;
}

interface LockMocks {
  open: Mock;
  readFile: Mock;
  stat: Mock;
  unlink: Mock;
}

function createHandle(inode: number): LockHandle {
  return {
    close: vi.fn(),
    stat: vi.fn().mockResolvedValue({ dev: 1, ino: inode }),
    writeFile: vi.fn(),
  };
}

const mocks: LockMocks = vi.hoisted(
  (): LockMocks => ({
    open: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  }),
);

vi.mock(
  'node:fs/promises',
  (): Record<string, Mock> => ({
    lstat: vi.fn(),
    mkdir: vi.fn(),
    open: mocks.open,
    readFile: mocks.readFile,
    rename: vi.fn(),
    stat: mocks.stat,
    unlink: mocks.unlink,
    writeFile: vi.fn(),
  }),
);

describe('managed VM lifecycle lock', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    mocks.unlink.mockResolvedValue(undefined);
  });

  it('does not unlink a successor lock during release', async (): Promise<void> => {
    const ownedHandle: LockHandle = createHandle(10);
    mocks.open.mockResolvedValueOnce(ownedHandle);
    mocks.stat.mockResolvedValue({ dev: 1, ino: 11 });
    const { acquireManagedVmLock } = await import('../src/services/managed-vm-lock.service');
    const release: () => Promise<void> = await acquireManagedVmLock();
    await release();
    expect(mocks.unlink).not.toHaveBeenCalled();
    expect(ownedHandle.close).toHaveBeenCalledOnce();
  });

  it('serializes stale recovery and replaces the stale lock before releasing recovery', async (): Promise<void> => {
    const lockExists: Error = Object.assign(new Error('exists'), { code: 'EEXIST' });
    const recoveryHandle: LockHandle = createHandle(20);
    const ownedHandle: LockHandle = createHandle(21);
    mocks.open
      .mockRejectedValueOnce(lockExists)
      .mockResolvedValueOnce(recoveryHandle)
      .mockResolvedValueOnce(ownedHandle);
    mocks.readFile.mockResolvedValue('invalid-owner\n');
    mocks.stat.mockResolvedValue({ dev: 1, ino: 21 });
    const { acquireManagedVmLock } = await import('../src/services/managed-vm-lock.service');
    const managedVmLockPath: string = '/var/lib/compartment/installer/install.lock';
    const release: () => Promise<void> = await acquireManagedVmLock();
    expect(mocks.unlink).toHaveBeenNthCalledWith(1, managedVmLockPath);
    expect(recoveryHandle.close).toHaveBeenCalledOnce();
    await release();
  });
});
