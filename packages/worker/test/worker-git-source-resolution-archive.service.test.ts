import { execFile, type ExecFileOptions } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  resolveGitSourceSnapshot,
  type ResolvedGitSourceSnapshot,
} from '../src/services/worker-git-source-resolution-archive.service';
import type { downloadGitHubRepositoryArchive } from '../src/services/worker-git-source-github.service';

type DownloadGitHubRepositoryArchive = typeof downloadGitHubRepositoryArchive;
type WorkerGitHubArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;

interface WorkerGitHubMocks {
  downloadGitHubRepositoryArchive: Mock<DownloadGitHubRepositoryArchive>;
}

const workerGitHubMocks: WorkerGitHubMocks = vi.hoisted(
  (): WorkerGitHubMocks => ({
    downloadGitHubRepositoryArchive: vi.fn<DownloadGitHubRepositoryArchive>(),
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
  await Promise.all(
    tempDirectories.map(async (directory: string): Promise<void> => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  tempDirectories.length = 0;
});

describe('resolveGitSourceSnapshot', (): void => {
  it('builds a binding-scoped archive from provider tarballs with unrelated root symlinks', async (): Promise<void> => {
    const providerArchive: Buffer = await createProviderArchive(
      {
        'repo-root/packages/browser-commenter/compartment.yml': `name: browser-commenter
services:
  web:
    path: .
    build:
      include:
        - ../shared
`,
        'repo-root/packages/browser-commenter/package.json': '{"name":"browser-commenter"}\n',
        'repo-root/packages/shared/message.mjs': 'export const message = "shared";\n',
      },
      {
        'repo-root/.env.shared': '.git/reddit-scraper/shared.env',
      },
    );
    workerGitHubMocks.downloadGitHubRepositoryArchive.mockImplementation(
      async (_task: WorkerGitHubArchiveTask, _commitSha: string, archivePath: string): Promise<void> => {
        await writeFile(archivePath, providerArchive);
      },
    );

    const snapshot: ResolvedGitSourceSnapshot = await resolveGitSourceSnapshot(createResolutionTask());
    const extractionDirectory: string = await extractArchive(snapshot.normalizedArchive);

    expect(snapshot.descriptor).toMatchObject({
      name: 'browser-commenter',
      services: {
        web: {
          build: {
            include: ['../shared'],
          },
          path: '.',
        },
      },
    });
    expect(await readFile(join(extractionDirectory, 'browser-commenter', 'package.json'), 'utf8')).toBe(
      '{"name":"browser-commenter"}\n',
    );
    expect(await readFile(join(extractionDirectory, 'shared', 'message.mjs'), 'utf8')).toBe(
      'export const message = "shared";\n',
    );
    expect(await readFile(join(extractionDirectory, '.compartment', 'source-package.json'), 'utf8')).toContain(
      '"descriptorDirectoryRelativePath": "browser-commenter"',
    );
    await expect(access(join(extractionDirectory, '.env.shared'))).rejects.toThrow();
  });
});

async function createProviderArchive(files: Record<string, string>, symlinks: Record<string, string>): Promise<Buffer> {
  const fixtureDirectory: string = await createTrackedTempDirectory('compartment-worker-git-source-archive-');
  const archivePath: string = join(fixtureDirectory, 'provider.tgz');

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]: [string, string]): Promise<void> => {
      const filePath: string = join(fixtureDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, contents, 'utf8');
    }),
  );
  await Promise.all(
    Object.entries(symlinks).map(async ([relativePath, targetPath]: [string, string]): Promise<void> => {
      const filePath: string = join(fixtureDirectory, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await symlink(targetPath, filePath);
    }),
  );
  await executeFileAsync('tar', ['-czf', archivePath, '-C', fixtureDirectory, 'repo-root']);

  return await readFile(archivePath);
}

async function extractArchive(sourceArchive: Buffer): Promise<string> {
  const archiveDirectory: string = await createTrackedTempDirectory('compartment-worker-git-source-normalized-');
  const archivePath: string = join(archiveDirectory, 'source.tgz');
  const extractionDirectory: string = join(archiveDirectory, 'extract');

  await mkdir(extractionDirectory, { recursive: true });
  await writeFile(archivePath, sourceArchive);
  await executeFileAsync('tar', ['-xzf', archivePath, '-C', extractionDirectory]);

  return extractionDirectory;
}

async function createTrackedTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);

  return directory;
}

function createResolutionTask(): WorkerClaimedGitSourceResolutionTask {
  return {
    branchName: 'main',
    commitSha: '5d3d3c93adb278920f7aec89d43cab9b790f3496',
    descriptorPath: 'packages/browser-commenter/compartment.yml',
    installationToken: 'installation-token',
    projectName: 'browser-commenter',
    providerHost: 'github.com',
    repositoryName: 'reddit-scraper',
    repositoryOwner: 'example-labs',
    sourceBindingId: 'sbd_123',
    sourceEventId: 'sev_123',
    sourceId: 'src_123',
    targetEnvironmentName: 'production',
    taskId: 'srt_123',
  };
}
