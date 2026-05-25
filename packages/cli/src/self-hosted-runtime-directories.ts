import { chmod, chown, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertNoExistingSelfHostedDirectorySymlinks,
  assertRealSelfHostedDirectory,
} from './self-hosted-host-directories';

const selfHostedRuntimeDirectoryMode: number = 0o700;
const selfHostedRuntimeDirectories: readonly string[] = [
  '/var/run/compartment',
  '/var/run/compartment/api',
  '/var/run/compartment/node',
  '/var/lib/compartment/self-hosted',
  '/var/lib/compartment/resource-backups',
];
const selfHostedRuntimeManagedDirectoryRoots: readonly string[] = ['/var/run/compartment', '/var/lib/compartment'].map(
  (path: string): string => resolve(path),
);

export async function ensureSelfHostedRuntimeDirectories(): Promise<void> {
  for (const directoryPath of selfHostedRuntimeDirectories) {
    await assertNoExistingSelfHostedDirectorySymlinks({
      directoryPath,
      label: 'Compartment runtime directory',
      managedRoots: selfHostedRuntimeManagedDirectoryRoots,
    });
    await mkdir(directoryPath, { mode: selfHostedRuntimeDirectoryMode, recursive: true });
    await assertRealSelfHostedDirectory(directoryPath, 'Compartment runtime directory');
    await applyRootOwnershipIfRoot(directoryPath);
    await chmod(directoryPath, selfHostedRuntimeDirectoryMode);
  }
}

async function applyRootOwnershipIfRoot(path: string): Promise<void> {
  if (process.getuid?.() !== 0) {
    return;
  }

  await chown(path, 0, 0);
}
