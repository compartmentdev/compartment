import { execFile, type ExecFileOptions } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  resolveGitSourceSyncDiscovery,
  type ResolvedGitSourceSyncDiscovery,
} from '../src/services/worker-git-source-sync-discovery.service';
import type {
  downloadGitHubRepositoryArchive,
  readGitHubBranchHeadSha,
} from '../src/services/worker-git-source-github.service';

type DownloadGitHubRepositoryArchive = typeof downloadGitHubRepositoryArchive;
type ReadGitHubBranchHeadSha = typeof readGitHubBranchHeadSha;
type WorkerGitHubArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;

interface WorkerGitHubMocks {
  downloadGitHubRepositoryArchive: Mock<DownloadGitHubRepositoryArchive>;
  readGitHubBranchHeadSha: Mock<ReadGitHubBranchHeadSha>;
}

const workerGitHubMocks: WorkerGitHubMocks = vi.hoisted(
  (): WorkerGitHubMocks => ({
    downloadGitHubRepositoryArchive: vi.fn<DownloadGitHubRepositoryArchive>(),
    readGitHubBranchHeadSha: vi.fn<ReadGitHubBranchHeadSha>(),
  }),
);

vi.mock('../src/services/worker-git-source-github.service', (): WorkerGitHubMocks => workerGitHubMocks);

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);

const tempDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  workerGitHubMocks.downloadGitHubRepositoryArchive.mockReset();
  workerGitHubMocks.readGitHubBranchHeadSha.mockReset();
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('resolveGitSourceSyncDiscovery', (): void => {
  it('derives watch paths from service paths and build.include paths', async (): Promise<void> => {
    const providerArchive: Buffer = await createProviderArchive({
      'repo-root/apps/web/package.json': '{"name":"web"}\n',
      'repo-root/ops/compartment.yml': `name: web
services:
  web:
    path: ../apps/web
    build:
      include:
        - ../shared
`,
      'repo-root/shared/settings.json': '{}\n',
    });
    workerGitHubMocks.downloadGitHubRepositoryArchive.mockImplementation(
      async (_task: WorkerGitHubArchiveTask, _commitSha: string, archivePath: string): Promise<void> => {
        await writeFile(archivePath, providerArchive);
      },
    );

    const discovery: ResolvedGitSourceSyncDiscovery = await resolveGitSourceSyncDiscovery(createSyncTask());

    expect(discovery).toMatchObject({
      resolvedCommitSha: 'sha_sync_discovery',
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: ['apps/web', 'shared'],
          descriptorDirectory: 'ops',
          descriptorPath: 'ops/compartment.yml',
          projectName: 'web',
        },
      ],
    });
  });

  it('blocks candidates whose service paths escape the repository boundary', async (): Promise<void> => {
    const providerArchive: Buffer = await createProviderArchive({
      'repo-root/compartment.yml': `name: web
services:
  web: ../outside
`,
    });
    workerGitHubMocks.downloadGitHubRepositoryArchive.mockImplementation(
      async (_task: WorkerGitHubArchiveTask, _commitSha: string, archivePath: string): Promise<void> => {
        await writeFile(archivePath, providerArchive);
      },
    );

    const discovery: ResolvedGitSourceSyncDiscovery = await resolveGitSourceSyncDiscovery(createSyncTask());

    expect(discovery.candidates).toEqual([
      {
        blockedReason: 'service path "../outside" escapes the repository boundary.',
        derivedWatchPaths: [],
        descriptorDirectory: '.',
        descriptorPath: 'compartment.yml',
        projectName: 'web',
      },
    ]);
  });
});

async function createProviderArchive(files: Record<string, string>): Promise<Buffer> {
  const fixtureDirectory: string = await createTrackedTempDirectory('compartment-worker-git-source-sync-');
  const archivePath: string = join(fixtureDirectory, 'provider.tgz');

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]: [string, string]): Promise<void> => {
      const filePath: string = join(fixtureDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }),
  );
  await executeFileAsync('tar', ['-czf', archivePath, '-C', fixtureDirectory, 'repo-root']);

  return await readFile(archivePath);
}

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}

function createSyncTask(): WorkerClaimedGitSourceSyncTask {
  return {
    claimToken: 'claim-token',
    installationToken: 'installation-token',
    providerHost: 'github.com',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    requestedBranchName: 'main',
    sourceId: 'src_123',
    taskId: 'sst_123',
    triggerCommitSha: 'sha_sync_discovery',
  };
}
