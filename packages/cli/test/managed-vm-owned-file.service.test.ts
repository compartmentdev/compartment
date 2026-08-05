import { chmod, mkdtemp, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureManagedVmDirectory, installNewManagedVmFile } from '../src/services/managed-vm-owned-file.service';

const temporaryDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path: string): Promise<void> => await rm(path, { recursive: true })),
  );
});

describe('managed VM owned filesystem boundary', (): void => {
  it('rejects a symbolic-link directory without mutating its target', async (): Promise<void> => {
    const root: string = await temporaryDirectory();
    const target: string = join(root, 'target');
    const link: string = join(root, 'owned-directory');
    await ensureManagedVmDirectory(target, 0o700);
    await symlink(target, link);

    await expect(ensureManagedVmDirectory(link, 0o700)).rejects.toThrow('refuses an unsafe directory');
    await expect(readlink(link)).resolves.toBe(target);
  });

  it('rejects an existing installer-owned directory with a broader mode', async (): Promise<void> => {
    const root: string = await temporaryDirectory();
    const directory: string = join(root, 'installer');
    await ensureManagedVmDirectory(directory, 0o700);
    await chmod(directory, 0o755);

    await expect(ensureManagedVmDirectory(directory, 0o700)).rejects.toThrow('refuses an unsafe directory');
  });

  it('refuses to follow a dangling destination link when installing an exact file', async (): Promise<void> => {
    const root: string = await temporaryDirectory();
    const destination: string = join(root, 'owned-file');
    await symlink(join(root, 'missing-target'), destination);

    await expect(installNewManagedVmFile(destination, 'verified content', 0o600)).rejects.toThrow();
    await expect(readlink(destination)).resolves.toBe(join(root, 'missing-target'));
  });
});

async function temporaryDirectory(): Promise<string> {
  const path: string = await mkdtemp(join(tmpdir(), 'compartment-owned-file-test-'));
  temporaryDirectories.push(path);
  return path;
}
