import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { buildGitHubApiBaseUrl } from '@compartment/utils';
import { Octokit } from '@octokit/rest';
import {
  createWorkerGitProviderArchiveTrustedOutboundFetch,
  createWorkerGitProviderTrustedOutboundFetch,
} from './worker-outbound-http.service';
import { WorkerGitProviderHttpError } from './worker-git-source-resolution-failure.support';
import type { WorkerGitSourceProvider } from './worker-git-source-provider.types';

type WorkerClaimedGitSourceArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;
type DownloadGitHubRepositoryArchive = typeof downloadGitHubRepositoryArchive;
type ReadGitHubBranchHeadSha = typeof readGitHubBranchHeadSha;

interface GitHubBranchApiResponse {
  data: {
    commit: {
      sha: string;
    };
  };
}

async function downloadGitHubRepositoryArchive(
  task: WorkerClaimedGitSourceArchiveTask,
  resolvedCommitSha: string,
  archivePath: string,
): Promise<void> {
  const response: Response = await createWorkerGitProviderArchiveTrustedOutboundFetch()(
    buildGitHubArchiveUrl(task, resolvedCommitSha),
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${task.providerAccessToken}`,
        'user-agent': 'compartment-worker',
      },
    },
  );
  if (!response.ok)
    throw new WorkerGitProviderHttpError(
      `GitHub repository archive download failed with HTTP ${response.status.toString()}.`,
      response.status,
    );
  if (response.body === null) throw new Error('GitHub repository archive response did not include a body.');

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
}

class WorkerGitHubSourceProvider implements WorkerGitSourceProvider {
  public readonly providerType: 'github_app' = 'github_app';
  public readonly downloadRepositoryArchive: DownloadGitHubRepositoryArchive = downloadGitHubRepositoryArchive;
  public readonly readBranchHeadSha: ReadGitHubBranchHeadSha = readGitHubBranchHeadSha;
}

export const workerGitHubSourceProvider: WorkerGitSourceProvider = new WorkerGitHubSourceProvider();

async function readGitHubBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
  const octokit: Octokit = createWorkerGitHubOctokit(task);
  const response: GitHubBranchApiResponse = await octokit.rest.repos.getBranch({
    branch: task.requestedBranchName,
    owner: task.repositoryOwner,
    repo: task.repositoryName,
  });
  const commitSha: string = response.data.commit.sha;
  if (commitSha.length === 0) {
    throw new Error(`GitHub branch ${task.requestedBranchName} did not return a commit SHA.`);
  }

  return commitSha;
}

function createWorkerGitHubOctokit(input: WorkerClaimedGitSourceArchiveTask): Octokit {
  return new Octokit({
    auth: input.providerAccessToken,
    baseUrl: buildGitHubApiBaseUrl(input.providerHost),
    request: {
      fetch: createWorkerGitProviderTrustedOutboundFetch(),
    },
    userAgent: 'compartment-worker',
  });
}

function buildGitHubArchiveUrl(task: WorkerClaimedGitSourceArchiveTask, resolvedCommitSha: string): URL {
  return new URL(
    `/repos/${encodeURIComponent(task.repositoryOwner)}/${encodeURIComponent(task.repositoryName)}/tarball/${encodeURIComponent(resolvedCommitSha)}`,
    buildGitHubApiBaseUrl(task.providerHost),
  );
}
