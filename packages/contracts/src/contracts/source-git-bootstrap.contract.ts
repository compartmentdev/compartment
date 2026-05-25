import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import {
  gitHubProviderRegistrationStatusSchema,
  gitProviderHostSchema,
  type GitHubProviderRegistrationStatus,
} from './source-git-provider.contract';
import { safeRelativePathSchema } from './safe-relative-path.contract';

export interface GitHubProviderBootstrapRequest {
  providerHost: string;
  repositoryOwner: string;
  returnTo?: string | undefined;
}

export interface GitHubProviderBootstrapResponse {
  bootstrapStateId: string | null;
  browserUrl: string | null;
  installationAccountLogin: string | null;
  installationId: string | null;
  providerHost: string;
  registrationId: string;
  repositoryOwner: string;
  status: GitHubProviderRegistrationStatus;
}

export interface GitHubInstallationRepositorySummary {
  defaultBranchName: string;
  fullName: string;
  id: string;
  name: string;
  owner: string;
  private: boolean;
}

export type GitHubInstallationRepositoryListStatus = 'ready' | 'provider_bootstrap_required';

export interface GitHubInstallationRepositoryListResponse {
  repositories: GitHubInstallationRepositorySummary[];
  status: GitHubInstallationRepositoryListStatus;
}

export interface GitHubInstallationRepositoryListRequest {
  providerHost: string;
  repositoryOwner: string;
}

export const gitHubProviderBootstrapRequestSchema: ContractSchema<GitHubProviderBootstrapRequest> = z
  .object({
    providerHost: gitProviderHostSchema,
    repositoryOwner: z.string().min(1),
    returnTo: safeRelativePathSchema.optional(),
  })
  .strict();

export const gitHubProviderBootstrapResponseSchema: ContractSchema<GitHubProviderBootstrapResponse> = z
  .object({
    bootstrapStateId: z.string().min(1).nullable(),
    browserUrl: z.string().url().nullable(),
    installationAccountLogin: z.string().min(1).nullable(),
    installationId: z.string().min(1).nullable(),
    providerHost: gitProviderHostSchema,
    registrationId: z.string().min(1),
    repositoryOwner: z.string().min(1),
    status: gitHubProviderRegistrationStatusSchema,
  })
  .strict();

const gitHubInstallationRepositorySummarySchema: ContractSchema<GitHubInstallationRepositorySummary> = z
  .object({
    defaultBranchName: z.string().min(1),
    fullName: z.string().min(1),
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.string().min(1),
    private: z.boolean(),
  })
  .strict();

const gitHubInstallationRepositoryListStatusSchema: ContractSchema<GitHubInstallationRepositoryListStatus> = z.enum([
  'ready',
  'provider_bootstrap_required',
]);

export const gitHubInstallationRepositoryListResponseSchema: ContractSchema<GitHubInstallationRepositoryListResponse> =
  z
    .object({
      repositories: z.array(gitHubInstallationRepositorySummarySchema),
      status: gitHubInstallationRepositoryListStatusSchema,
    })
    .strict();

export const gitHubInstallationRepositoryListRequestSchema: ContractSchema<GitHubInstallationRepositoryListRequest> = z
  .object({
    providerHost: gitProviderHostSchema,
    repositoryOwner: z.string().min(1),
  })
  .strict();
