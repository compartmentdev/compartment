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

type WorkerClaimedGitSourceArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;

interface GitHubBranchApiResponse {
  data: {
    commit: {
      sha: string;
    };
  };
}

export async function downloadGitHubRepositoryArchive(
  task: WorkerClaimedGitSourceArchiveTask,
  resolvedCommitSha: string,
  archivePath: string,
): Promise<void> {
  const response: Response = await createWorkerGitProviderArchiveTrustedOutboundFetch()(
    buildGitHubArchiveUrl(task, resolvedCommitSha),
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${task.installationToken}`,
        'user-agent': 'compartment-worker',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub repository archive download failed with HTTP ${response.status.toString()}.`);
  }
  if (response.body === null) {
    throw new Error('GitHub repository archive response did not include a body.');
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
}

export async function readGitHubBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
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
    auth: input.installationToken,
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
