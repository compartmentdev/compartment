import { open, readFile, stat, unlink, type FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { managedVmStateDirectory } from './managed-vm-state.service';
import { ensureManagedVmDirectory } from './managed-vm-owned-file.service';

const managedVmLockPath: string = `${managedVmStateDirectory}/install.lock`;
const managedVmLockRecoveryPath: string = `${managedVmLockPath}.recovery`;

export async function acquireManagedVmLock(): Promise<() => Promise<void>> {
  await ensureManagedVmDirectory(managedVmStateDirectory, 0o700);
  const handle: FileHandle = await openLockWithStaleRecovery();
  await handle.writeFile(`${String(process.pid)} ${new Date().toISOString()}\n`);
  return async (): Promise<void> => {
    try {
      const [ownedLock, currentLock]: [Stats, Stats] = await Promise.all([handle.stat(), stat(managedVmLockPath)]);
      if (ownedLock.dev === currentLock.dev && ownedLock.ino === currentLock.ino) {
        await unlink(managedVmLockPath);
      }
    } catch (error) {
      if (!(error instanceof Error && isMissing(error))) {
        throw error;
      }
    } finally {
      await handle.close();
    }
  };
}

async function openLockWithStaleRecovery(): Promise<FileHandle> {
  try {
    return await open(managedVmLockPath, 'wx', 0o600);
  } catch (error) {
    if (!(error instanceof Error && isAlreadyExists(error))) {
      throw error;
    }
    return await recoverStaleLock(error);
  }
}

async function recoverStaleLock(lockExistsError: Error): Promise<FileHandle> {
  const recoveryHandle: FileHandle = await acquireRecoveryLock(lockExistsError);
  try {
    await recoveryHandle.writeFile(`${String(process.pid)}\n`);
    if (!(await isStaleLock())) {
      throw lockExistsError;
    }
    await unlink(managedVmLockPath);
    return await open(managedVmLockPath, 'wx', 0o600);
  } finally {
    await recoveryHandle.close();
    await unlink(managedVmLockRecoveryPath).catch((error: Error): void => {
      if (!isMissing(error)) {
        throw error;
      }
    });
  }
}

async function acquireRecoveryLock(lockExistsError: Error): Promise<FileHandle> {
  try {
    return await open(managedVmLockRecoveryPath, 'wx', 0o600);
  } catch (error) {
    if (error instanceof Error && isAlreadyExists(error)) {
      throw lockExistsError;
    }
    throw error;
  }
}

async function isStaleLock(): Promise<boolean> {
  try {
    const content: string = await readFile(managedVmLockPath, 'utf8');
    const pid: number = Number(content.trim().split(/\s+/u)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return true;
    }
    return !isProcessRunning(pid);
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return false;
    }
    const details: Stats = await stat(managedVmLockPath);
    return Date.now() - details.mtimeMs > 60_000;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && isNoSuchProcess(error));
  }
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}
function isAlreadyExists(error: Error): boolean {
  return 'code' in error && error.code === 'EEXIST';
}
function isNoSuchProcess(error: Error): boolean {
  return 'code' in error && error.code === 'ESRCH';
}
