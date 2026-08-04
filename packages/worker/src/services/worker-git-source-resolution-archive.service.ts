import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceArchive, type CreatedSourceArchive } from '@compartment/source-archive';
import {
  type CompartmentAuthoredDescriptor,
  type CompartmentRoutesFile,
  type WorkerClaimedGitSourceResolutionTask,
} from '@compartment/contracts';
import {
  readGitSourceDescriptorFiles,
  requireMatchingDescriptorProjectName,
  type ParsedGitSourceDescriptorFiles,
} from './worker-git-source-resolution-parse.service';
import { extractTarArchiveWithoutSameOwner } from './worker-archive-extraction.service';
import { downloadGitHubRepositoryArchive } from './worker-git-source-github.service';
import { readExtractedRepositoryRoot } from './worker-git-source-archive.support';

export interface ResolvedGitSourceSnapshot {
  descriptor: CompartmentAuthoredDescriptor;
  normalizedArchive: Buffer;
  routes?: CompartmentRoutesFile | undefined;
  sourceDigest: string;
}

export async function resolveGitSourceSnapshot(
  task: WorkerClaimedGitSourceResolutionTask,
): Promise<ResolvedGitSourceSnapshot> {
  const tempDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-git-source-resolution-'));

  try {
    return await resolveGitSourceSnapshotInDirectory(tempDirectory, task);
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}

async function resolveGitSourceSnapshotInDirectory(
  tempDirectory: string,
  task: WorkerClaimedGitSourceResolutionTask,
): Promise<ResolvedGitSourceSnapshot> {
  const downloadedArchivePath: string = join(tempDirectory, 'provider.tgz');
  const extractionDirectory: string = join(tempDirectory, 'extract');

  await downloadGitHubRepositoryArchive(task, task.commitSha, downloadedArchivePath);
  await mkdir(extractionDirectory, { recursive: true });
  await extractTarArchiveWithoutSameOwner(downloadedArchivePath, extractionDirectory);

  const repositoryRoot: string = await readExtractedRepositoryRoot(extractionDirectory);
  const descriptorFiles: ParsedGitSourceDescriptorFiles = await readGitSourceDescriptorFiles(
    repositoryRoot,
    task.descriptorPath,
  );
  requireMatchingDescriptorProjectName(descriptorFiles.descriptor, task.projectName, task.descriptorPath);
  const sourceArchive: CreatedSourceArchive = await readNormalizedSourceArchive(repositoryRoot, task, descriptorFiles);

  return {
    descriptor: descriptorFiles.descriptor,
    normalizedArchive: sourceArchive.sourceArchive,
    ...(descriptorFiles.routes !== undefined ? { routes: descriptorFiles.routes } : {}),
    sourceDigest: sourceArchive.sourceDigest,
  };
}

async function readNormalizedSourceArchive(
  repositoryRoot: string,
  task: WorkerClaimedGitSourceResolutionTask,
  descriptorFiles: ParsedGitSourceDescriptorFiles,
): Promise<CreatedSourceArchive> {
  return await createSourceArchive({
    descriptor: descriptorFiles.descriptor,
    descriptorFilePath: join(repositoryRoot, task.descriptorPath),
    repositoryBoundaryDirectory: repositoryRoot,
    ...(descriptorFiles.routes !== undefined ? { routes: descriptorFiles.routes } : {}),
  });
}
