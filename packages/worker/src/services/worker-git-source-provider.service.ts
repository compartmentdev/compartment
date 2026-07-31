import type { WorkerClaimedGitSourceResolutionTask, WorkerClaimedGitSourceSyncTask } from '@compartment/contracts';
import { downloadGitHubRepositoryArchive, readGitHubBranchHeadSha } from './worker-git-source-github.service';
import { downloadGitLabRepositoryArchive, readGitLabBranchHeadSha } from './worker-git-source-gitlab.service';

type WorkerClaimedGitSourceArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;

export async function downloadGitSourceRepositoryArchive(
  task: WorkerClaimedGitSourceArchiveTask,
  commitSha: string,
  archivePath: string,
): Promise<void> {
  if ((task.providerType ?? 'github_app') === 'gitlab') {
    await downloadGitLabRepositoryArchive(task, commitSha, archivePath);
    return;
  }
  await downloadGitHubRepositoryArchive(task, commitSha, archivePath);
}

export async function readGitSourceBranchHeadSha(task: WorkerClaimedGitSourceSyncTask): Promise<string> {
  return (task.providerType ?? 'github_app') === 'gitlab'
    ? await readGitLabBranchHeadSha(task)
    : await readGitHubBranchHeadSha(task);
}
