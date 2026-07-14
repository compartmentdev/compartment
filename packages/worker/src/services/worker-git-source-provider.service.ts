import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { workerGitHubSourceProvider } from './worker-git-source-github.service';
import { workerGitLabSourceProvider } from './worker-git-source-gitlab.service';
import type { WorkerClaimedGitSourceArchiveTask, WorkerGitSourceProvider } from './worker-git-source-provider.types';

const providers: readonly WorkerGitSourceProvider[] = [workerGitHubSourceProvider, workerGitLabSourceProvider];

export async function downloadGitSourceRepositoryArchive(
  task: WorkerClaimedGitSourceArchiveTask,
  commitSha: string,
  archivePath: string,
): Promise<void> {
  await requireProvider(task).downloadRepositoryArchive(task, commitSha, archivePath);
}

export async function readGitSourceBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
  return await requireProvider(task).readBranchHeadSha(task);
}

function requireProvider(
  task: WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask,
): WorkerGitSourceProvider {
  const provider: WorkerGitSourceProvider | undefined = providers.find(
    (candidate: WorkerGitSourceProvider): boolean => candidate.providerType === task.providerType,
  );
  if (provider === undefined) throw new Error(`Unsupported git provider type ${task.providerType}.`);
  return provider;
}
