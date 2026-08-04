import { createHash, type Hash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const logicalSourceDigestVersion: string = 'v1';
const logicalSourceDigestAlgorithm: string = 'sha256';
const executableModeMask: number = 0o111;

export async function createLogicalSourceDigest(
  archiveRoot: string,
  archiveEntries: readonly string[],
  generatedMetadataPath: string,
  generatedMetadata: string,
): Promise<string> {
  const hash: Hash = createHash(logicalSourceDigestAlgorithm);
  appendField(hash, `${logicalSourceDigestVersion}:${logicalSourceDigestAlgorithm}`);

  for (const entryPath of [...archiveEntries].sort(compareLogicalSourcePaths)) {
    await appendFileSystemEntry(hash, archiveRoot, entryPath);
  }
  appendEntry(hash, generatedMetadataPath, 'file', 0, Buffer.from(generatedMetadata));

  return `${logicalSourceDigestVersion}:${logicalSourceDigestAlgorithm}:${hash.digest('hex')}`;
}

export function compareLogicalSourcePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

async function appendFileSystemEntry(hash: Hash, archiveRoot: string, entryPath: string): Promise<void> {
  const stats: Stats = await lstat(join(archiveRoot, entryPath));
  if (stats.isDirectory()) {
    appendEntry(hash, entryPath, 'directory', 0, Buffer.alloc(0));
    return;
  }
  if (!stats.isFile()) {
    throw new Error(`Logical source digest entry "${entryPath}" must be a file or directory.`);
  }

  appendEntry(hash, entryPath, 'file', stats.mode & executableModeMask, await readFile(join(archiveRoot, entryPath)));
}

function appendEntry(
  hash: Hash,
  entryPath: string,
  entryType: 'directory' | 'file',
  executableMode: number,
  content: Buffer,
): void {
  appendField(hash, entryPath);
  appendField(hash, entryType);
  appendField(hash, executableMode.toString(8));
  appendField(hash, String(content.byteLength));
  hash.update(content);
}

function appendField(hash: Hash, value: string): void {
  const bytes: Buffer = Buffer.from(value);
  hash.update(String(bytes.byteLength));
  hash.update(':');
  hash.update(bytes);
}
