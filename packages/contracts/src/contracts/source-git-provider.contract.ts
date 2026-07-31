import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type GitProviderType = 'github_app' | 'gitlab';
export type GitHubProviderRegistrationStatus = 'active' | 'failed' | 'pending';
export type GitDescriptorPlanStatus = 'descriptor_found' | 'descriptor_missing';
export type GitDescriptorPullRequestState = 'closed' | 'merged' | 'open';

export interface CreateGitLabProviderRegistrationRequest {
  accessToken: string;
  providerHost: string;
}

export interface GitProviderRegistrationSummary {
  createdAt: string;
  expiresAt: string | null;
  providerAccountLogin: string;
  providerHost: string;
  providerType: GitProviderType;
  registrationId: string;
}

export interface CreateGitProviderRegistrationResponse {
  registration: GitProviderRegistrationSummary;
}

export interface GitProviderRegistrationListResponse {
  registrations: GitProviderRegistrationSummary[];
}

export interface GitProviderRepositorySummary {
  defaultBranchName: string;
  fullName: string;
  id: string;
  name: string;
  owner: string;
  private: boolean;
}

export interface GitProviderRegistrationRepositoryListResponse {
  repositories: GitProviderRepositorySummary[];
}

export const gitProviderTypeSchema: ContractSchema<GitProviderType> = z.enum(['github_app', 'gitlab']);
export const gitHubProviderRegistrationStatusSchema: ContractSchema<GitHubProviderRegistrationStatus> = z.enum([
  'active',
  'failed',
  'pending',
]);
export const gitDescriptorPlanStatusSchema: ContractSchema<GitDescriptorPlanStatus> = z.enum([
  'descriptor_found',
  'descriptor_missing',
]);
export const gitDescriptorPullRequestStateSchema: ContractSchema<GitDescriptorPullRequestState> = z.enum([
  'closed',
  'merged',
  'open',
]);

export const gitProviderHostSchema: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeGitProviderHost)
  .refine(isValidGitProviderHost, 'Expected a valid git provider hostname.');

export const createGitLabProviderRegistrationRequestSchema: ContractSchema<CreateGitLabProviderRegistrationRequest> = z
  .object({
    accessToken: z.string().min(1),
    providerHost: gitProviderHostSchema,
  })
  .strict();

export const gitProviderRegistrationSummarySchema: ContractSchema<GitProviderRegistrationSummary> = z
  .object({
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    providerAccountLogin: z.string().min(1),
    providerHost: gitProviderHostSchema,
    providerType: gitProviderTypeSchema,
    registrationId: z.string().min(1),
  })
  .strict();

export const createGitProviderRegistrationResponseSchema: ContractSchema<CreateGitProviderRegistrationResponse> = z
  .object({ registration: gitProviderRegistrationSummarySchema })
  .strict();

export const gitProviderRegistrationListResponseSchema: ContractSchema<GitProviderRegistrationListResponse> = z
  .object({ registrations: z.array(gitProviderRegistrationSummarySchema) })
  .strict();

export const gitProviderRepositorySummarySchema: ContractSchema<GitProviderRepositorySummary> = z
  .object({
    defaultBranchName: z.string().min(1),
    fullName: z.string().min(1),
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.string().min(1),
    private: z.boolean(),
  })
  .strict();

export const gitProviderRegistrationRepositoryListResponseSchema: ContractSchema<GitProviderRegistrationRepositoryListResponse> =
  z.object({ repositories: z.array(gitProviderRepositorySummarySchema) }).strict();

function normalizeGitProviderHost(value: string): string {
  return value.trim().toLowerCase();
}

function isValidGitProviderHost(value: string): boolean {
  try {
    const parsed: URL = new URL(`https://${value}`);
    return parsed.host === value && parsed.hostname !== '';
  } catch {
    return false;
  }
}
