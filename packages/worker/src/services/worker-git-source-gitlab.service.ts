import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { buildGitLabApiBaseUrl } from '@compartment/utils';
import { z } from 'zod';
import {
  createWorkerGitProviderArchiveTrustedOutboundFetch,
  createWorkerGitProviderTrustedOutboundFetch,
} from './worker-outbound-http.service';
import { createNonRetryableGitSourceTaskError } from './worker-git-source-resolution-failure.support';

type WorkerClaimedGitLabArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;
interface GitLabBranchResponse {
  commit: { id: string };
}
const branchSchema: z.ZodType<GitLabBranchResponse> = z
  .object({ commit: z.object({ id: z.string().min(1) }) })
  .passthrough();

export async function downloadGitLabRepositoryArchive(
  task: WorkerClaimedGitLabArchiveTask,
  commitSha: string,
  archivePath: string,
): Promise<void> {
  const projectId: string = requireRepositoryExternalId(task.repositoryExternalId);
  const url: URL = new URL(
    `${buildGitLabApiBaseUrl(task.providerHost)}/projects/${encodeURIComponent(projectId)}/repository/archive.tar.gz`,
  );
  url.searchParams.set('sha', commitSha);
  const response: Response = await createWorkerGitProviderArchiveTrustedOutboundFetch()(url, {
    headers: { authorization: `Bearer ${task.installationToken}` },
  });
  if (!response.ok)
    throw new Error(`GitLab repository archive download failed with HTTP ${response.status.toString()}.`);
  if (response.body === null) throw new Error('GitLab repository archive response did not include a body.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
}

export async function readGitLabBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
  const projectId: string = requireRepositoryExternalId(task.repositoryExternalId);
  const url: URL = new URL(
    `${buildGitLabApiBaseUrl(task.providerHost)}/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(task.requestedBranchName)}`,
  );
  const response: Response = await createWorkerGitProviderTrustedOutboundFetch()(url, {
    headers: { authorization: `Bearer ${task.installationToken}` },
  });
  if (!response.ok) throw new Error(`GitLab branch lookup failed with HTTP ${response.status.toString()}.`);
  return branchSchema.parse(await response.json()).commit.id;
}

function requireRepositoryExternalId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    // Sync has no retryable wire flag, so this task-neutral failure deliberately retries to maxAttempts there.
    throw createNonRetryableGitSourceTaskError('GitLab git-source task is missing repositoryExternalId.');
  }
  return value;
}
