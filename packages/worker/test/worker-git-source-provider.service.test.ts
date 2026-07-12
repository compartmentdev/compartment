import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadGitSourceRepositoryArchive,
  readGitSourceBranchHeadSha,
} from '../src/services/worker-git-source-provider.service';
import {
  downloadGitHubRepositoryArchive,
  readGitHubBranchHeadSha,
} from '../src/services/worker-git-source-github.service';
import {
  downloadGitLabRepositoryArchive,
  readGitLabBranchHeadSha,
} from '../src/services/worker-git-source-gitlab.service';

vi.mock('../src/services/worker-git-source-github.service');
vi.mock('../src/services/worker-git-source-gitlab.service');

describe('git-source provider dispatcher', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('defaults legacy claims to GitHub and dispatches GitLab claims', async (): Promise<void> => {
    const legacy: WorkerClaimedGitSourceResolutionTask = buildResolutionTask();
    const gitlab: WorkerClaimedGitSourceResolutionTask = {
      ...legacy,
      providerHost: 'gitlab.com',
      providerType: 'gitlab',
      repositoryExternalId: '42',
    };
    await downloadGitSourceRepositoryArchive(legacy, 'abc', '/tmp/archive');
    await downloadGitSourceRepositoryArchive(gitlab, 'abc', '/tmp/archive');
    expect(downloadGitHubRepositoryArchive).toHaveBeenCalledWith(legacy, 'abc', '/tmp/archive');
    expect(downloadGitLabRepositoryArchive).toHaveBeenCalledWith(gitlab, 'abc', '/tmp/archive');
  });

  it('dispatches branch lookup by provider', async (): Promise<void> => {
    vi.mocked(readGitHubBranchHeadSha).mockResolvedValue('github-sha');
    vi.mocked(readGitLabBranchHeadSha).mockResolvedValue('gitlab-sha');
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
    installationToken: 'token',
    projectName: 'app',
    providerHost: 'github.com',
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
    installationToken: 'token',
    providerHost: 'github.com',
    repositoryName: 'repo',
    repositoryOwner: 'owner',
    requestedBranchName: 'main',
    sourceId: 'src_1',
    taskId: 'task_1',
    triggerCommitSha: null,
  };
}
