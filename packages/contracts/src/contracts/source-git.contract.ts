import { z } from 'zod';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './deployments.contract';
import type { ContractSchema } from './schema.types';
import { gitSourceExclusionSummarySchema, type GitSourceExclusionSummary } from './source-git-settings.contract';
import { gitSourceDescriptorPathSchema, gitSourceRepositoryPathSchema } from './source-git-sync-path.contract';
import { gitProviderHostSchema } from './source-git-provider.contract';

export { type GitHubProviderRegistrationStatus, type GitProviderType } from './source-git-provider.contract';
export {
  type GitHubInstallationRepositoryListResponse,
  type GitHubInstallationRepositoryListRequest,
  type GitHubInstallationRepositorySummary,
  type GitHubProviderBootstrapRequest,
  type GitHubProviderBootstrapResponse,
  type GitProviderRepositorySummary,
  gitHubInstallationRepositoryListRequestSchema,
  gitHubInstallationRepositoryListResponseSchema,
  gitHubProviderBootstrapRequestSchema,
  gitHubProviderBootstrapResponseSchema,
} from './source-git-bootstrap.contract';
export {
  readGitSourceDescriptorDirectory,
  readGitSourceDescriptorProjectMismatchMessage,
} from './source-git-descriptor-path.contract';
export {
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorCandidate,
  type GitDescriptorDraftFile,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
  createGitDescriptorPullRequestRequestSchema,
  gitDescriptorPlanRequestSchema,
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusRequestSchema,
  gitDescriptorPullRequestStatusResponseSchema,
} from './source-git-descriptor.contract';

export type GitSourceStatus = 'active' | 'disabled' | 'disconnected';

export interface GitSourceBranchMappingInput {
  branchName: string;
  environmentName: string;
}

export interface GitSourceBindingInput {
  autoDeployEnabled: boolean;
  branchMapping: GitSourceBranchMappingInput;
  descriptorPath: string;
  projectName: string;
}

export interface ConnectGitSourceRequest {
  autoAdoptNewApps: boolean;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  descriptorPathToInclude?: string | undefined;
  providerHost: string;
  registrationId?: string | undefined;
  repositoryName: string;
  repositoryOwner: string;
  syncBranchName: string;
}

export interface GitSourceBindingSummary {
  autoDeployEnabled: boolean;
  branchName: string;
  descriptorPath: string;
  environmentName: string;
  id: string;
  projectId: string;
  projectName: string;
  status: GitSourceStatus;
}

export interface GitSourceSummary {
  defaultBranchName: string;
  displayName: string;
  id: string;
  providerHost: string;
  repositoryCloneUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  status: GitSourceStatus;
}

export type GitSourceLatestSyncStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'canceled';
export type GitSourceLatestSyncCandidateStatus = 'accepted' | 'blocked';

export interface GitSourceLatestSyncCandidate {
  blockedReason: string | null;
  derivedWatchPaths: string[];
  descriptorDirectory: string;
  descriptorPath: string;
  id: string;
  projectName: string | null;
  status: GitSourceLatestSyncCandidateStatus;
}

export interface GitSourceLatestSync {
  candidates: GitSourceLatestSyncCandidate[];
  failureReason: string | null;
  id: string;
  requestedBranchName: string;
  resolvedCommitSha: string | null;
  status: GitSourceLatestSyncStatus;
}

export interface GitSourceListResponse {
  sources: GitSourceSummary[];
}

export interface GitSourceDetails extends GitSourceSummary {
  autoAdoptNewApps: boolean;
  bindings: GitSourceBindingSummary[];
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  exclusions: GitSourceExclusionSummary[];
  latestSync: GitSourceLatestSync | null;
}

export interface GitSourceResponse {
  source: GitSourceDetails;
}

export interface DisconnectGitSourceResponse {
  sourceId: string;
  success: true;
}

const gitSourceStatusSchema: ContractSchema<GitSourceStatus> = z.enum(['active', 'disabled', 'disconnected']);
const gitSourceLatestSyncStatusSchema: ContractSchema<GitSourceLatestSyncStatus> = z.enum([
  'pending',
  'claimed',
  'completed',
  'failed',
  'canceled',
]);
const gitSourceLatestSyncCandidateStatusSchema: ContractSchema<GitSourceLatestSyncCandidateStatus> = z.enum([
  'accepted',
  'blocked',
]);
export const connectGitSourceRequestSchema: ContractSchema<ConnectGitSourceRequest> = z
  .object({
    autoAdoptNewApps: z.boolean(),
    defaultAutoDeployEnabled: z.boolean(),
    defaultEnvironmentName: environmentNameSchema,
    descriptorPathToInclude: gitSourceDescriptorPathSchema.optional(),
    providerHost: gitProviderHostSchema,
    registrationId: z.string().min(1).optional(),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    syncBranchName: z.string().min(1),
  })
  .strict();

const gitSourceLatestSyncCandidateSchema: ContractSchema<GitSourceLatestSyncCandidate> = z
  .object({
    blockedReason: z.string().min(1).nullable(),
    derivedWatchPaths: z.array(gitSourceRepositoryPathSchema),
    descriptorDirectory: z.string().trim().min(1),
    descriptorPath: gitSourceDescriptorPathSchema,
    id: z.string().min(1),
    projectName: compartmentProjectNameSchema.nullable(),
    status: gitSourceLatestSyncCandidateStatusSchema,
  })
  .strict();

export const gitSourceLatestSyncSchema: ContractSchema<GitSourceLatestSync> = z
  .object({
    candidates: z.array(gitSourceLatestSyncCandidateSchema),
    failureReason: z.string().min(1).nullable(),
    id: z.string().min(1),
    requestedBranchName: z.string().min(1),
    resolvedCommitSha: z.string().min(1).nullable(),
    status: gitSourceLatestSyncStatusSchema,
  })
  .strict();

const gitSourceBindingSummarySchema: z.ZodType<GitSourceBindingSummary> = z
  .object({
    autoDeployEnabled: z.boolean(),
    branchName: z.string().min(1),
    descriptorPath: gitSourceDescriptorPathSchema,
    environmentName: environmentNameSchema,
    id: z.string().min(1),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    status: gitSourceStatusSchema,
  })
  .strict();

type GitSourceSummaryObjectSchema = z.ZodObject<{
  defaultBranchName: z.ZodString;
  displayName: z.ZodString;
  id: z.ZodString;
  providerHost: typeof gitProviderHostSchema;
  repositoryCloneUrl: z.ZodString;
  repositoryName: z.ZodString;
  repositoryOwner: z.ZodString;
  status: typeof gitSourceStatusSchema;
}>;

const gitSourceSummarySchema: GitSourceSummaryObjectSchema = z
  .object({
    defaultBranchName: z.string().min(1),
    displayName: z.string().min(1),
    id: z.string().min(1),
    providerHost: gitProviderHostSchema,
    repositoryCloneUrl: z.string().url(),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    status: gitSourceStatusSchema,
  })
  .strict();

const gitSourceDetailsSchema: ContractSchema<GitSourceDetails> = gitSourceSummarySchema.extend({
  autoAdoptNewApps: z.boolean(),
  bindings: z.array(gitSourceBindingSummarySchema),
  defaultAutoDeployEnabled: z.boolean(),
  defaultEnvironmentName: environmentNameSchema,
  exclusions: z.array(gitSourceExclusionSummarySchema),
  latestSync: gitSourceLatestSyncSchema.nullable(),
});

export const gitSourceListResponseSchema: ContractSchema<GitSourceListResponse> = z
  .object({
    sources: z.array(gitSourceSummarySchema),
  })
  .strict();

export const gitSourceResponseSchema: ContractSchema<GitSourceResponse> = z
  .object({
    source: gitSourceDetailsSchema,
  })
  .strict();

export const disconnectGitSourceResponseSchema: ContractSchema<DisconnectGitSourceResponse> = z
  .object({
    sourceId: z.string().min(1),
    success: z.literal(true),
  })
  .strict();
