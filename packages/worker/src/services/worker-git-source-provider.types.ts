import type {
  GitProviderType,
  WorkerClaimedGitSourceResolutionTask,
  WorkerClaimedGitSourceSyncTask,
} from '@compartment/contracts';

export type WorkerClaimedGitSourceArchiveTask = WorkerClaimedGitSourceResolutionTask | WorkerClaimedGitSourceSyncTask;

export interface WorkerGitSourceProvider {
  readonly downloadRepositoryArchive: (
    task: WorkerClaimedGitSourceArchiveTask,
    commitSha: string,
    archivePath: string,
  ) => Promise<void>;
  providerType: GitProviderType;
  readonly readBranchHeadSha: (task: WorkerClaimedGitSourceSyncTask) => Promise<string>;
}
