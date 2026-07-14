import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadGitSourceRepositoryArchive,
  readGitSourceBranchHeadSha,
} from '../src/services/worker-git-source-provider.service';
import {
  isRetryableGitSourceTaskError,
  WorkerGitProviderHttpError,
} from '../src/services/worker-git-source-resolution-failure.support';
import { workerGitHubSourceProvider } from '../src/services/worker-git-source-github.service';
import { workerGitLabSourceProvider } from '../src/services/worker-git-source-gitlab.service';

vi.mock('../src/services/worker-git-source-github.service');
vi.mock('../src/services/worker-git-source-gitlab.service');

describe('git-source provider dispatcher', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('dispatches claims by their required provider discriminator', async (): Promise<void> => {
    const github: WorkerClaimedGitSourceResolutionTask = buildResolutionTask();
    const gitlab: WorkerClaimedGitSourceResolutionTask = {
      ...github,
      providerHost: 'gitlab.com',
      providerType: 'gitlab',
      repositoryExternalId: '42',
    };
    await downloadGitSourceRepositoryArchive(github, 'abc', '/tmp/archive');
    await downloadGitSourceRepositoryArchive(gitlab, 'abc', '/tmp/archive');
    expect(workerGitHubSourceProvider.downloadRepositoryArchive).toHaveBeenCalledWith(github, 'abc', '/tmp/archive');
    expect(workerGitLabSourceProvider.downloadRepositoryArchive).toHaveBeenCalledWith(gitlab, 'abc', '/tmp/archive');
  });

  it.each([
    [401, false],
    [403, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ])('classifies stubbed provider HTTP %i as retryable=%s', (status: number, retryable: boolean): void => {
    expect(isRetryableGitSourceTaskError(new WorkerGitProviderHttpError('stubbed provider response', status))).toBe(
      retryable,
    );
  });

  it('dispatches branch lookup by provider', async (): Promise<void> => {
    vi.mocked(workerGitHubSourceProvider.readBranchHeadSha).mockResolvedValue('github-sha');
    vi.mocked(workerGitLabSourceProvider.readBranchHeadSha).mockResolvedValue('gitlab-sha');
    expect(await readGitSourceBranchHeadSha(buildSyncTask())).toBe('github-sha');
    expect(
      await readGitSourceBranchHeadSha({
        ...buildSyncTask(),
        providerHost: 'gitlab.com',
        providerType: 'gitlab',
        repositoryExternalId: '42',
      }),
    ).toBe('gitlab-sha');
  });
});

function buildResolutionTask(): WorkerClaimedGitSourceResolutionTask {
  return {
    branchName: 'main',
    commitSha: 'abc',
    descriptorPath: 'compartment.yml',
    providerAccessToken: 'token',
    projectName: 'app',
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryExternalId: 'repo_1',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    sourceBindingId: 'sbd_1',
    sourceEventId: 'sev_1',
    sourceId: 'src_1',
    targetEnvironmentName: 'production',
    taskId: 'task_1',
  };
}

function buildSyncTask(): WorkerClaimedGitSourceSyncTask {
  return {
    claimToken: 'claim',
    providerAccessToken: 'token',
    providerHost: 'github.com',
    providerType: 'github_app',
    repositoryExternalId: 'repo_1',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    requestedBranchName: 'main',
    sourceId: 'src_1',
    taskId: 'task_1',
    triggerCommitSha: null,
  };
}
