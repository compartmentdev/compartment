import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import {
  gitSourceLatestSyncSchema,
  type GitSourceLatestSync,
  type GitSourceLatestSyncCandidate,
} from './source-git.contract';

export type GitSourceSyncTaskStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'canceled';
export type GitSourceSyncCandidateStatus = 'accepted' | 'blocked';
export type GitSourceSyncCandidate = GitSourceLatestSyncCandidate;
export type GitSourceSyncTask = GitSourceLatestSync;

export interface GitSourceSyncTaskResponse {
  task: GitSourceSyncTask;
}

const gitSourceSyncTaskSchema: ContractSchema<GitSourceSyncTask> = gitSourceLatestSyncSchema;

export const gitSourceSyncTaskResponseSchema: ContractSchema<GitSourceSyncTaskResponse> = z
  .object({
    task: gitSourceSyncTaskSchema,
  })
  .strict();
