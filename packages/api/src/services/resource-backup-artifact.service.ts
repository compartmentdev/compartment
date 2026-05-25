import { createHash, type Hash } from 'node:crypto';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join, resolve } from 'node:path';
import { isPathWithinDirectory } from '@compartment/utils';
import { getApiConfig } from '../runtime/runtime-access';
import { repairPrivateRuntimeStoragePermissions } from './private-runtime-storage-permissions.service';
import {
  assertPrivateRuntimeStorageChildDirectory,
  createPrivateRuntimeStorageChildDirectory,
} from './private-runtime-storage-boundary.service';
import { sanitizeStorageArtifactId } from './storage-artifact-id.service';

export interface ResourceBackupArtifactSummary {
  checksum: string;
  location: string;
  sizeBytes: number;
}

export async function prepareResourceBackupArtifactDirectory(backupId: string): Promise<string> {
  const path: string = resolveResourceBackupArtifactPath(backupId);
  await createPrivateRuntimeStorageChildDirectory({
    label: 'Resource backup artifact directory',
    path,
    storageRoot: getApiConfig().resourceBackupDirectory,
  });

  return path;
}

export async function summarizeResourceBackupArtifact(backupId: string): Promise<ResourceBackupArtifactSummary> {
  const location: string = resolveResourceBackupArtifactPath(backupId);
  const backupDirectory: string = getApiConfig().resourceBackupDirectory;
  await repairResourceBackupArtifactDirectory(location, backupDirectory);
  const files: string[] = await listArtifactFiles(location);
  const hash: Hash = createHash('sha256');
  let sizeBytes: number = 0;

  for (const file of files) {
    const contents: Buffer = await readFile(file);
    hash.update(file.slice(location.length + 1));
    hash.update(contents);
    sizeBytes += contents.byteLength;
  }

  return {
    checksum: hash.digest('hex'),
    location,
    sizeBytes,
  };
}

async function repairResourceBackupArtifactDirectory(location: string, backupDirectory: string): Promise<void> {
  await assertResourceBackupArtifactDirectory(location, backupDirectory);
  await repairPrivateRuntimeStoragePermissions(location);
  await assertResourceBackupArtifactDirectory(location, backupDirectory);
}

async function assertResourceBackupArtifactDirectory(location: string, backupDirectory: string): Promise<void> {
  await assertPrivateRuntimeStorageChildDirectory({
    label: 'Resource backup artifact directory',
    path: location,
    storageRoot: backupDirectory,
  });
}

export async function deleteResourceBackupArtifactDirectory(artifactLocation: string): Promise<void> {
  assertArtifactLocationBelongsToBackupDirectory(artifactLocation);
  await rm(artifactLocation, { force: true, recursive: true });
}

function resolveResourceBackupArtifactPath(backupId: string): string {
  const backupDirectory: string = getApiConfig().resourceBackupDirectory;

  return join(backupDirectory, sanitizeStorageArtifactId(backupId));
}

function assertArtifactLocationBelongsToBackupDirectory(artifactLocation: string): void {
  const backupDirectory: string = resolve(getApiConfig().resourceBackupDirectory);
  const artifactPath: string = resolve(artifactLocation);
  if (artifactPath === backupDirectory || !isPathWithinDirectory(backupDirectory, artifactPath)) {
    throw new Error('Refusing to delete a resource backup artifact outside the backup directory.');
  }
}

async function listArtifactFiles(directory: string): Promise<string[]> {
  const entries: string[] = await readdir(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath: string = join(directory, entry);
    const entryStat: Stats = await lstat(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...(await listArtifactFiles(entryPath)));
    } else if (entryStat.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left: string, right: string): number => left.localeCompare(right));
}
