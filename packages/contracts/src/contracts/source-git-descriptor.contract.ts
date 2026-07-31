import { z } from 'zod';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import type { ContractSchema } from './schema.types';
import {
  gitDescriptorPlanStatusSchema,
  gitDescriptorPullRequestStateSchema,
  gitProviderHostSchema,
  type GitDescriptorPlanStatus,
  type GitDescriptorPullRequestState,
} from './source-git-provider.contract';
import { gitSourceDescriptorPathSchema, gitSourceRepositoryPathSchema } from './source-git-sync-path.contract';

export interface GitDescriptorPlanRequest {
  branchName: string;
  providerHost: string;
  registrationId: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitDescriptorCandidate {
  appFolder: string;
  descriptorPath: string;
  files: GitDescriptorDraftFile[];
  id: string;
  packageJsonPath: string | null;
  projectName: string;
}

export interface GitDescriptorDraftFile {
  content: string;
  path: string;
}

export interface GitDescriptorPlanResponse {
  branchName: string;
  candidates: GitDescriptorCandidate[];
  descriptorPath: string | null;
  preview: string | null;
  repositoryName: string;
  repositoryOwner: string;
  status: GitDescriptorPlanStatus;
}

export interface CreateGitDescriptorPullRequestRequest {
  appFolder: string;
  branchName: string;
  descriptorPath: string;
  files: GitDescriptorDraftFile[];
  projectName: string;
  providerHost: string;
  registrationId: string;
  repositoryName: string;
  repositoryOwner: string;
}

export interface GitDescriptorPullRequestResponse {
  descriptorPath: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  state: GitDescriptorPullRequestState;
  statusToken: string;
}

export interface GitDescriptorPullRequestStatusResponse {
  pullRequestNumber: number;
  pullRequestUrl: string;
  state: GitDescriptorPullRequestState;
}

export interface GitDescriptorPullRequestStatusRequest {
  providerHost: string;
  pullRequestNumber: number;
  registrationId: string;
  repositoryName: string;
  repositoryOwner: string;
  statusToken: string;
}

export const gitDescriptorPlanRequestSchema: ContractSchema<GitDescriptorPlanRequest> = z
  .object({
    branchName: z.string().min(1),
    providerHost: gitProviderHostSchema,
    registrationId: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
  })
  .strict();

const gitDescriptorDraftFileSchema: ContractSchema<GitDescriptorDraftFile> = z
  .object({
    content: z.string().min(1),
    path: gitSourceRepositoryPathSchema,
  })
  .strict();

const gitDescriptorCandidateSchema: ContractSchema<GitDescriptorCandidate> = z
  .object({
    appFolder: gitSourceRepositoryPathSchema,
    descriptorPath: gitSourceDescriptorPathSchema,
    files: z.array(gitDescriptorDraftFileSchema).min(1),
    id: z.string().min(1),
    packageJsonPath: gitSourceRepositoryPathSchema.nullable(),
    projectName: compartmentProjectNameSchema,
  })
  .strict();

export const gitDescriptorPlanResponseSchema: ContractSchema<GitDescriptorPlanResponse> = z
  .object({
    branchName: z.string().min(1),
    candidates: z.array(gitDescriptorCandidateSchema),
    descriptorPath: gitSourceDescriptorPathSchema.nullable(),
    preview: z.string().min(1).nullable(),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    status: gitDescriptorPlanStatusSchema,
  })
  .strict();

export const createGitDescriptorPullRequestRequestSchema: ContractSchema<CreateGitDescriptorPullRequestRequest> = z
  .object({
    appFolder: gitSourceRepositoryPathSchema,
    branchName: z.string().min(1),
    descriptorPath: gitSourceDescriptorPathSchema,
    files: z.array(gitDescriptorDraftFileSchema).min(1),
    projectName: compartmentProjectNameSchema,
    providerHost: gitProviderHostSchema,
    registrationId: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
  })
  .strict();

const gitDescriptorHttpsUrlSchema: z.ZodType<string> = z
  .string()
  .url()
  .refine((value: string): boolean => new URL(value).protocol === 'https:', {
    message: 'Pull request URL must use HTTPS.',
  });

export const gitDescriptorPullRequestResponseSchema: ContractSchema<GitDescriptorPullRequestResponse> = z
  .object({
    descriptorPath: gitSourceDescriptorPathSchema,
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: gitDescriptorHttpsUrlSchema,
    state: gitDescriptorPullRequestStateSchema,
    statusToken: z.string().min(1),
  })
  .strict();

export const gitDescriptorPullRequestStatusResponseSchema: ContractSchema<GitDescriptorPullRequestStatusResponse> = z
  .object({
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: gitDescriptorHttpsUrlSchema,
    state: gitDescriptorPullRequestStateSchema,
  })
  .strict();

export const gitDescriptorPullRequestStatusRequestSchema: ContractSchema<GitDescriptorPullRequestStatusRequest> = z
  .object({
    providerHost: gitProviderHostSchema,
    pullRequestNumber: z.number().int().positive(),
    registrationId: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    statusToken: z.string().min(1),
  })
  .strict();
