import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { isMissingFileSystemEntryError } from '../../lib/file-system-path.mjs';

const GENERATED_ROOT_DIRECTORY = 'public-docs/src/content/docs/reference/generated';

export async function recreateGeneratedRootDirectory() {
  await rm(GENERATED_ROOT_DIRECTORY, { force: true, recursive: true });
  await mkdir(GENERATED_ROOT_DIRECTORY, { recursive: true });
}

export async function writeTextIfChanged(path, text) {
  const normalizedText = await normalizeGeneratedText(path, text);
  const previousText = await readOptionalText(path);
  if (previousText === normalizedText) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalizedText);
}

async function normalizeGeneratedText(path, text) {
  const normalizedText = text.endsWith('\n') ? text : `${text}\n`;
  if (!path.endsWith('.md')) {
    return normalizedText;
  }

  const prettierConfig = await resolveConfig(path);
  return await format(normalizedText, {
    ...prettierConfig,
    filepath: path,
  });
}

export async function readGeneratedSnapshot() {
  return await readDirectorySnapshot(GENERATED_ROOT_DIRECTORY);
}

async function readOptionalText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileSystemEntryError(error)) {
      return null;
    }

    throw error;
  }
}

async function readDirectorySnapshot(rootDirectory) {
  try {
    return await readDirectorySnapshotRecursive(rootDirectory, rootDirectory);
  } catch (error) {
    if (isMissingFileSystemEntryError(error)) {
      return '';
    }

    throw error;
  }
}

async function readDirectorySnapshotRecursive(rootDirectory, currentDirectory) {
  const entries = [];
  const directoryEntries = await readdir(currentDirectory, { withFileTypes: true });
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of directoryEntries) {
    const entryPath = join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      entries.push(await readDirectorySnapshotRecursive(rootDirectory, entryPath));
      continue;
    }

    const relativePath = entryPath.slice(rootDirectory.length + 1);
    const content = await readFile(entryPath, 'utf8');
    entries.push(`FILE ${relativePath}\n${content}`);
  }

  return entries.join('\n');
}
