import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import { gitProviderRepositorySummarySchema, type GitProviderRepositorySummary } from './source-git-bootstrap.contract';
import { gitProviderHostSchema } from './source-git-provider.contract';

export interface CreateGitLabProviderRegistrationRequest {
  accessToken: string;
  providerHost: string;
}

export interface GitLabProviderRegistrationSummary {
  createdAt: string;
  providerHost: string;
  registrationId: string;
  tokenHolderLogin: string;
}

export interface CreateGitLabProviderRegistrationResponse {
  registration: GitLabProviderRegistrationSummary;
}

export interface GitLabProviderRegistrationListResponse {
  activeGitHubProviderHosts: string[];
  registrations: GitLabProviderRegistrationSummary[];
}

export interface GitLabRegistrationRepositoryListResponse {
  repositories: GitProviderRepositorySummary[];
}

export const createGitLabProviderRegistrationRequestSchema: ContractSchema<CreateGitLabProviderRegistrationRequest> = z
  .object({
    accessToken: z.string().min(1),
    providerHost: gitProviderHostSchema,
  })
  .strict();

const gitLabProviderRegistrationSummarySchema: ContractSchema<GitLabProviderRegistrationSummary> = z
  .object({
    createdAt: z.string().min(1),
    providerHost: gitProviderHostSchema,
    registrationId: z.string().min(1),
    tokenHolderLogin: z.string().min(1),
  })
  .strict();

export const createGitLabProviderRegistrationResponseSchema: ContractSchema<CreateGitLabProviderRegistrationResponse> =
  z
    .object({
      registration: gitLabProviderRegistrationSummarySchema,
    })
    .strict();

export const gitLabProviderRegistrationListResponseSchema: ContractSchema<GitLabProviderRegistrationListResponse> = z
  .object({
    activeGitHubProviderHosts: z.array(gitProviderHostSchema),
    registrations: z.array(gitLabProviderRegistrationSummarySchema),
  })
  .strict();

export const gitLabRegistrationRepositoryListResponseSchema: ContractSchema<GitLabRegistrationRepositoryListResponse> =
  z
    .object({
      repositories: z.array(gitProviderRepositorySummarySchema),
    })
    .strict();
