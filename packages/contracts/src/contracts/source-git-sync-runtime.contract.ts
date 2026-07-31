import { z } from 'zod';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import type { ContractSchema } from './schema.types';
import { gitProviderTypeSchema, type GitProviderType } from './source-git-provider.contract';
import { gitSourceDescriptorPathSchema, gitSourceRepositoryPathSchema } from './source-git-sync-path.contract';

export interface WorkerClaimedGitSourceSyncTask {
  claimToken: string;
  installationToken: string;
  providerHost: string;
  providerType?: GitProviderType | undefined;
  repositoryExternalId?: string | undefined;
  repositoryName: string;
  repositoryOwner: string;
  requestedBranchName: string;
  sourceId: string;
  taskId: string;
  triggerCommitSha: string | null;
}

export interface WorkerClaimGitSourceSyncTaskResponse {
  task: WorkerClaimedGitSourceSyncTask | null;
}

export interface WorkerCompletedGitSourceSyncCandidate {
  blockedReason: string | null;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  projectName: string | null;
}

export interface WorkerCompleteGitSourceSyncTaskRequest {
  candidates: WorkerCompletedGitSourceSyncCandidate[];
  claimToken: string;
  resolvedCommitSha: string;
  taskId: string;
}

export interface WorkerFailGitSourceSyncTaskRequest {
  claimToken: string;
  failureReason: string;
  taskId: string;
}

export const workerClaimNextGitSourceSyncTaskPathname: string = '/internal/git-source-sync-tasks/claim-next';
export const workerCompleteGitSourceSyncTaskPathname: string = '/internal/git-source-sync-tasks/complete';
export const workerFailGitSourceSyncTaskPathname: string = '/internal/git-source-sync-tasks/fail';

const workerClaimedGitSourceSyncTaskSchema: ContractSchema<WorkerClaimedGitSourceSyncTask> = z
  .object({
    claimToken: z.string().min(1),
    installationToken: z.string().min(1),
    providerHost: z.string().min(1),
    providerType: gitProviderTypeSchema.optional(),
    repositoryExternalId: z.string().min(1).optional(),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    requestedBranchName: z.string().min(1),
    sourceId: z.string().min(1),
    taskId: z.string().min(1),
    triggerCommitSha: z.string().min(1).nullable(),
  })
  .strict();

const workerCompletedGitSourceSyncCandidateSchema: ContractSchema<WorkerCompletedGitSourceSyncCandidate> = z
  .object({
    blockedReason: z.string().min(1).nullable(),
    derivedWatchPaths: z.array(gitSourceRepositoryPathSchema),
    descriptorDirectory: z.string().trim().min(1),
    descriptorPath: gitSourceDescriptorPathSchema,
    projectName: compartmentProjectNameSchema.nullable(),
  })
  .strict();

export const workerClaimGitSourceSyncTaskResponseSchema: ContractSchema<WorkerClaimGitSourceSyncTaskResponse> = z
  .object({
    task: workerClaimedGitSourceSyncTaskSchema.nullable(),
  })
  .strict();

export const workerCompleteGitSourceSyncTaskRequestSchema: ContractSchema<WorkerCompleteGitSourceSyncTaskRequest> = z
  .object({
    candidates: z.array(workerCompletedGitSourceSyncCandidateSchema),
    claimToken: z.string().min(1),
    resolvedCommitSha: z.string().min(1),
    taskId: z.string().min(1),
  })
  .strict();

export const workerFailGitSourceSyncTaskRequestSchema: ContractSchema<WorkerFailGitSourceSyncTaskRequest> = z
  .object({
    claimToken: z.string().min(1),
    failureReason: z.string().min(1),
    taskId: z.string().min(1),
  })
  .strict();
