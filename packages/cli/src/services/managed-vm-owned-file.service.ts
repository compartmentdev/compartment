import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { managedVmDirectoryIdentity, managedVmFileIdentity } from './managed-vm-state.service';

export async function installNewManagedVmFile(
  destination: string,
  content: string | Buffer,
  mode: number,
): Promise<string> {
  const temporaryPath: string = `${destination}.${String(process.pid)}.${randomUUID()}.tmp`;
  await writeVerifiedManagedVmTemporaryFile(temporaryPath, content, mode);
  try {
    await link(temporaryPath, destination);
  } finally {
    await removeManagedVmTemporaryFile(temporaryPath);
  }
  return managedVmFileIdentity(content, mode);
}

async function writeVerifiedManagedVmTemporaryFile(
  temporaryPath: string,
  content: string | Buffer,
  mode: number,
): Promise<void> {
  const handle: FileHandle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
    mode,
  );
  try {
    await handle.writeFile(content);
    await handle.chmod(mode);
    await handle.sync();
    const details: Stats = await handle.stat();
    if (!details.isFile() || (details.mode & 0o7777) !== mode) {
      throw new Error(`Managed-VM provisioning could not install the expected regular file at ${temporaryPath}.`);
    }
    await handle.close();
  } catch (error) {
    await handle.close().catch((): void => undefined);
    await removeManagedVmTemporaryFile(temporaryPath);
    throw error;
  }
}

async function removeManagedVmTemporaryFile(temporaryPath: string): Promise<void> {
  await unlink(temporaryPath).catch((error: Error): void => {
    if (!isMissing(error)) {
      throw error;
    }
  });
}

export async function ensureManagedVmDirectory(path: string, mode: number): Promise<string> {
  const details: Stats | undefined = await readPathDetails(path);
  if (details !== undefined) {
    assertDirectory(path, details, mode);
    return managedVmDirectoryIdentity(details);
  }
  const parent: string = dirname(path);
  if (parent !== path) {
    await ensureManagedVmParentDirectory(parent);
  }
  await createManagedVmDirectory(path, mode);
  const created: Stats = await lstat(path);
  assertDirectory(path, created, mode);
  return managedVmDirectoryIdentity(created);
}

async function ensureManagedVmParentDirectory(path: string): Promise<void> {
  const details: Stats | undefined = await readPathDetails(path);
  if (details !== undefined) {
    assertSafeParentDirectory(path, details);
    return;
  }
  const parent: string = dirname(path);
  if (parent !== path) {
    await ensureManagedVmParentDirectory(parent);
  }
  await createManagedVmDirectory(path, 0o755);
  assertDirectory(path, await lstat(path), 0o755);
}

async function readPathDetails(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function createManagedVmDirectory(path: string, mode: number): Promise<void> {
  try {
    await mkdir(path, { mode });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
  }
}

function assertDirectory(path: string, details: Stats, mode: number): void {
  if (!details.isDirectory() || details.isSymbolicLink() || details.uid !== 0 || (details.mode & 0o7777) !== mode) {
    throw new Error(`Managed-VM provisioning refuses an unsafe directory at ${path}.`);
  }
}

function assertSafeParentDirectory(path: string, details: Stats): void {
  if (!details.isDirectory() || details.isSymbolicLink() || details.uid !== 0 || (details.mode & 0o022) !== 0) {
    throw new Error(`Managed-VM provisioning refuses an unsafe parent directory at ${path}.`);
  }
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}
