import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IgnoreRuleSet } from './source-archive-ignore.helpers';
import {
  isArchivePathIgnored,
  isIgnoredSymlinkArchivePath,
  shouldSkipDirectoryEntry,
  type SourceArchiveIgnoreState,
} from './source-archive-entry-list.ignore';
import {
  addDirectoryEntry,
  assertSelectedSourcePathIsNotSymlink,
  joinRelativePath,
  readSortedDirectoryEntries,
} from './source-archive-entry-list.helpers';
import { hasVcsMetadataPathSegment } from './source-archive-plan.helpers';
import type { PlannedSourceArchive } from './source-archive-plan.service.types';
import { compareLogicalSourcePaths } from './source-logical-digest.service';

interface SourceArchiveWalkState extends SourceArchiveIgnoreState {
  entries: Set<string>;
}

export async function listIncludedSourceArchiveEntries(input: PlannedSourceArchive): Promise<string[]> {
  const state: SourceArchiveWalkState = {
    archiveRootRelativeToIgnoreRoot: input.archiveRootRelativeToIgnoreRoot,
    entries: new Set<string>(),
    ignoreRoot: input.ignoreRoot,
    ignoreRulesByBasePath: new Map<string, Promise<IgnoreRuleSet | null>>(),
  };

  for (const descriptorEntry of input.descriptorEntries) {
    await appendSelectedPathEntries(input.archiveRoot, descriptorEntry, state, false);
  }
  for (const serviceEntry of input.serviceEntries) {
    await appendSelectedPathEntries(input.archiveRoot, serviceEntry, state, true, serviceEntry);
  }
  for (const includeEntry of input.includeEntries) {
    await appendSelectedPathEntries(input.archiveRoot, includeEntry, state, true, includeEntry);
  }

  return [...state.entries].sort(compareLogicalSourcePaths);
}

async function appendSelectedPathEntries(
  archiveRoot: string,
  relativePath: string,
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined = undefined,
): Promise<void> {
  if (hasVcsMetadataPathSegment(relativePath)) {
    return;
  }

  const absolutePath: string = join(archiveRoot, relativePath);
  const targetStats: Stats = await lstat(absolutePath);
  if (targetStats.isSymbolicLink()) {
    assertSelectedSourcePathIsNotSymlink(relativePath);
  }
  if (!targetStats.isDirectory()) {
    await appendFileEntry(relativePath, state, respectIgnoreRules, selectedServiceRoot);
    return;
  }

  await appendDirectoryEntries(archiveRoot, relativePath, state, respectIgnoreRules, selectedServiceRoot);
}

async function appendDirectoryEntries(
  archiveRoot: string,
  directoryRelativePath: string,
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  await appendPendingDirectoryEntries(
    archiveRoot,
    [directoryRelativePath],
    state,
    respectIgnoreRules,
    selectedServiceRoot,
  );
}

async function appendPendingDirectoryEntries(
  archiveRoot: string,
  pendingDirectories: string[],
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  while (pendingDirectories.length > 0) {
    const currentDirectoryPath: string | undefined = pendingDirectories.pop();
    if (currentDirectoryPath === undefined) {
      continue;
    }
    if (respectIgnoreRules && (await shouldSkipDirectoryEntry(currentDirectoryPath, state, selectedServiceRoot))) {
      continue;
    }
    await appendCurrentDirectoryEntries(
      archiveRoot,
      currentDirectoryPath,
      pendingDirectories,
      state,
      respectIgnoreRules,
      selectedServiceRoot,
    );
  }
}

async function appendCurrentDirectoryEntries(
  archiveRoot: string,
  currentDirectoryPath: string,
  pendingDirectories: string[],
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  addDirectoryEntry(currentDirectoryPath, state.entries);
  const children: string[] = await readSortedDirectoryEntries(join(archiveRoot, currentDirectoryPath));
  await appendDirectoryChildEntries(
    archiveRoot,
    currentDirectoryPath,
    children,
    pendingDirectories,
    state,
    respectIgnoreRules,
    selectedServiceRoot,
  );
}

async function appendDirectoryChildEntries(
  archiveRoot: string,
  directoryRelativePath: string,
  children: readonly string[],
  pendingDirectories: string[],
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  for (let index: number = children.length - 1; index >= 0; index -= 1) {
    const childName: string | undefined = children[index];
    await appendDirectoryChildEntry(
      archiveRoot,
      directoryRelativePath,
      childName,
      pendingDirectories,
      state,
      respectIgnoreRules,
      selectedServiceRoot,
    );
  }
}

async function appendDirectoryChildEntry(
  archiveRoot: string,
  directoryRelativePath: string,
  childName: string | undefined,
  pendingDirectories: string[],
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  if (childName === undefined || hasVcsMetadataPathSegment(childName)) {
    return;
  }

  const childRelativePath: string = joinRelativePath(directoryRelativePath, childName);
  const childStats: Stats = await lstat(join(archiveRoot, childRelativePath));
  if (childStats.isDirectory()) {
    pendingDirectories.push(childRelativePath);
    return;
  }
  if (childStats.isSymbolicLink()) {
    await appendSymlinkEntry(childRelativePath, state, respectIgnoreRules, selectedServiceRoot);
    return;
  }

  await appendFileEntry(childRelativePath, state, respectIgnoreRules, selectedServiceRoot);
}

async function appendFileEntry(
  relativePath: string,
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  if (respectIgnoreRules && (await isArchivePathIgnored(state, relativePath, false, selectedServiceRoot))) {
    return;
  }

  state.entries.add(relativePath);
}

async function appendSymlinkEntry(
  relativePath: string,
  state: SourceArchiveWalkState,
  respectIgnoreRules: boolean,
  selectedServiceRoot: string | undefined,
): Promise<void> {
  if (respectIgnoreRules && (await isIgnoredSymlinkArchivePath(state, relativePath, selectedServiceRoot))) {
    return;
  }

  assertSelectedSourcePathIsNotSymlink(relativePath);
}
