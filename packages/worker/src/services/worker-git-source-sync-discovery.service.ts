import type { Dirent } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import {
  compartmentAuthoredDescriptorSchema,
  compartmentDescriptorFileName,
  normalizeCompartmentSourcePackageRelativePath,
  readGitSourceDescriptorDirectory,
  resolveCompartmentServiceBuildConfig,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredService,
  type WorkerClaimedGitSourceSyncTask,
  type WorkerCompletedGitSourceSyncCandidate,
} from '@compartment/contracts';
import { extractTarArchiveWithoutSameOwner } from './worker-archive-extraction.service';
import { readExtractedRepositoryRoot } from './worker-git-source-archive.support';
import { downloadGitSourceRepositoryArchive, readGitSourceBranchHeadSha } from './worker-git-source-provider.service';
import { parseGitSourceYaml } from './worker-git-source-yaml.service';

export interface ResolvedGitSourceSyncDiscovery {
  candidates: WorkerCompletedGitSourceSyncCandidate[];
  resolvedCommitSha: string;
}

export async function resolveGitSourceSyncDiscovery(
  task: WorkerClaimedGitSourceSyncTask,
): Promise<ResolvedGitSourceSyncDiscovery> {
  const resolvedCommitSha: string = task.triggerCommitSha ?? (await readGitSourceBranchHeadSha(task));
  const tempDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-git-source-sync-'));

  try {
    return await resolveGitSourceSyncDiscoveryInDirectory(tempDirectory, task, resolvedCommitSha);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function resolveGitSourceSyncDiscoveryInDirectory(
  tempDirectory: string,
  task: WorkerClaimedGitSourceSyncTask,
  resolvedCommitSha: string,
): Promise<ResolvedGitSourceSyncDiscovery> {
  const downloadedArchivePath: string = join(tempDirectory, 'provider.tgz');
  const extractionDirectory: string = join(tempDirectory, 'extract');

  await downloadGitSourceRepositoryArchive(task, resolvedCommitSha, downloadedArchivePath);
  await mkdir(extractionDirectory, { recursive: true });
  await extractTarArchiveWithoutSameOwner(downloadedArchivePath, extractionDirectory);

  const repositoryRoot: string = await readExtractedRepositoryRoot(extractionDirectory);
  const descriptorPaths: string[] = await listDescriptorPaths(repositoryRoot);

  return {
    candidates: await readGitSourceSyncCandidates(repositoryRoot, descriptorPaths),
    resolvedCommitSha,
  };
}

async function readGitSourceSyncCandidates(
  repositoryRoot: string,
  descriptorPaths: readonly string[],
): Promise<WorkerCompletedGitSourceSyncCandidate[]> {
  const candidates: WorkerCompletedGitSourceSyncCandidate[] = await Promise.all(
    descriptorPaths.map(async (descriptorPath: string): Promise<WorkerCompletedGitSourceSyncCandidate> => {
      return await buildGitSourceSyncCandidate(repositoryRoot, descriptorPath);
    }),
  );

  return candidates.sort(
    (left: WorkerCompletedGitSourceSyncCandidate, right: WorkerCompletedGitSourceSyncCandidate): number =>
      left.descriptorPath.localeCompare(right.descriptorPath),
  );
}

async function buildGitSourceSyncCandidate(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<WorkerCompletedGitSourceSyncCandidate> {
  const descriptorDirectory: string = readGitSourceDescriptorDirectory(descriptorPath);
  const descriptor: CompartmentAuthoredDescriptor | Error = await readDescriptorOrError(repositoryRoot, descriptorPath);
  if (descriptor instanceof Error) {
    return buildBlockedGitSourceSyncCandidate(descriptorDirectory, descriptorPath, null, descriptor.message);
  }

  return buildDerivedWatchPathsCandidate(repositoryRoot, descriptorDirectory, descriptorPath, descriptor);
}

function buildDerivedWatchPathsCandidate(
  repositoryRoot: string,
  descriptorDirectory: string,
  descriptorPath: string,
  descriptor: CompartmentAuthoredDescriptor,
): WorkerCompletedGitSourceSyncCandidate {
  try {
    return {
      blockedReason: null,
      derivedWatchPaths: readDerivedWatchPaths(repositoryRoot, descriptorPath, descriptor),
      descriptorDirectory,
      descriptorPath,
      projectName: descriptor.name,
    };
  } catch (error) {
    return buildBlockedGitSourceSyncCandidate(
      descriptorDirectory,
      descriptorPath,
      descriptor.name,
      error instanceof Error ? error.message : 'Failed to derive watch paths.',
    );
  }
}

async function readDescriptorOrError(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<CompartmentAuthoredDescriptor | Error> {
  try {
    return await readDescriptorAtPath(repositoryRoot, descriptorPath);
  } catch (error) {
    return error instanceof Error ? error : new Error('Failed to parse compartment descriptor.');
  }
}

async function readDescriptorAtPath(
  repositoryRoot: string,
  descriptorPath: string,
): Promise<CompartmentAuthoredDescriptor> {
  const descriptorFilePath: string = join(repositoryRoot, descriptorPath);
  return compartmentAuthoredDescriptorSchema.parse(parseGitSourceYaml(await readFile(descriptorFilePath, 'utf8')));
}

function readDerivedWatchPaths(
  repositoryRoot: string,
  descriptorPath: string,
  descriptor: CompartmentAuthoredDescriptor,
): string[] {
  const descriptorDirectory: string = readGitSourceDescriptorDirectory(descriptorPath);
  const derivedWatchPaths: Set<string> = new Set<string>();

  for (const service of Object.values(descriptor.services)) {
    derivedWatchPaths.add(
      resolveRepositoryWatchPath(repositoryRoot, descriptorDirectory, readServicePath(service), 'service path'),
    );
    for (const includePath of readServiceBuildIncludePaths(service)) {
      derivedWatchPaths.add(
        resolveRepositoryWatchPath(repositoryRoot, descriptorDirectory, includePath, 'build.include path'),
      );
    }
  }

  return [...derivedWatchPaths].sort((left: string, right: string): number => left.localeCompare(right));
}

function readServicePath(service: CompartmentAuthoredService): string {
  return typeof service === 'string' ? service : service.path;
}

function readServiceBuildIncludePaths(service: CompartmentAuthoredService): string[] {
  if (typeof service === 'string') {
    return [];
  }

  return resolveCompartmentServiceBuildConfig(service.build).include;
}

function resolveRepositoryWatchPath(
  repositoryRoot: string,
  descriptorDirectory: string,
  authoredPath: string,
  label: string,
): string {
  const descriptorDirectoryPath: string =
    descriptorDirectory === '.' ? repositoryRoot : join(repositoryRoot, descriptorDirectory);
  const absolutePath: string = resolve(descriptorDirectoryPath, authoredPath);
  const repositoryRelativePath: string = normalizeCompartmentSourcePackageRelativePath(
    relative(repositoryRoot, absolutePath),
  );
  if (repositoryRelativePath === '..' || repositoryRelativePath.startsWith('../')) {
    throw new Error(`${label} "${authoredPath}" escapes the repository boundary.`);
  }

  return repositoryRelativePath;
}

function buildBlockedGitSourceSyncCandidate(
  descriptorDirectory: string,
  descriptorPath: string,
  projectName: string | null,
  blockedReason: string,
): WorkerCompletedGitSourceSyncCandidate {
  return {
    blockedReason,
    derivedWatchPaths: [],
    descriptorDirectory,
    descriptorPath,
    projectName,
  };
}

async function listDescriptorPaths(repositoryRoot: string): Promise<string[]> {
  const descriptorPaths: string[] = [];
  await collectDescriptorPaths(repositoryRoot, repositoryRoot, descriptorPaths);
  return descriptorPaths.sort((left: string, right: string): number => left.localeCompare(right));
}

async function collectDescriptorPaths(
  repositoryRoot: string,
  currentDirectory: string,
  descriptorPaths: string[],
): Promise<void> {
  const entries: Dirent[] = await readdir(currentDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath: string = join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      await collectDescriptorPaths(repositoryRoot, entryPath, descriptorPaths);
      continue;
    }
    if (entry.isFile() && entry.name === compartmentDescriptorFileName) {
      descriptorPaths.push(normalizeCompartmentSourcePackageRelativePath(relative(repositoryRoot, entryPath)));
    }
  }
}
