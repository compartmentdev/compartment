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
