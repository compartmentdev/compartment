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
import { WorkerGitProviderHttpError } from './worker-git-source-resolution-failure.support';
import type { WorkerGitSourceProvider } from './worker-git-source-provider.types';

type WorkerClaimedGitLabArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;
type DownloadGitLabRepositoryArchive = typeof downloadGitLabRepositoryArchive;
type ReadGitLabBranchHeadSha = typeof readGitLabBranchHeadSha;
interface GitLabBranchResponse {
  commit: { id: string };
}
const branchSchema: z.ZodType<GitLabBranchResponse> = z
  .object({ commit: z.object({ id: z.string().min(1) }) })
  .passthrough();

async function downloadGitLabRepositoryArchive(
  task: WorkerClaimedGitLabArchiveTask,
  commitSha: string,
  archivePath: string,
): Promise<void> {
  const projectId: string = task.repositoryExternalId;
  const url: URL = new URL(
    `${buildGitLabApiBaseUrl(task.providerHost)}/projects/${encodeURIComponent(projectId)}/repository/archive.tar.gz`,
  );
  url.searchParams.set('sha', commitSha);
  const response: Response = await createWorkerGitProviderArchiveTrustedOutboundFetch()(url, {
    headers: { authorization: `Bearer ${task.providerAccessToken}` },
  });
  if (!response.ok)
    throw new WorkerGitProviderHttpError(
      `GitLab repository archive download failed with HTTP ${response.status.toString()}.`,
      response.status,
    );
  if (response.body === null) throw new Error('GitLab repository archive response did not include a body.');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
}

async function readGitLabBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
  const projectId: string = task.repositoryExternalId;
  const url: URL = new URL(
    `${buildGitLabApiBaseUrl(task.providerHost)}/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(task.requestedBranchName)}`,
  );
  const response: Response = await createWorkerGitProviderTrustedOutboundFetch()(url, {
    headers: { authorization: `Bearer ${task.providerAccessToken}` },
  });
  if (!response.ok)
    throw new WorkerGitProviderHttpError(
      `GitLab branch lookup failed with HTTP ${response.status.toString()}.`,
      response.status,
    );
  return branchSchema.parse(await response.json()).commit.id;
}

class WorkerGitLabSourceProvider implements WorkerGitSourceProvider {
  public readonly providerType: 'gitlab' = 'gitlab';
  public readonly downloadRepositoryArchive: DownloadGitLabRepositoryArchive = downloadGitLabRepositoryArchive;
  public readonly readBranchHeadSha: ReadGitLabBranchHeadSha = readGitLabBranchHeadSha;
}

export const workerGitLabSourceProvider: WorkerGitSourceProvider = new WorkerGitLabSourceProvider();
