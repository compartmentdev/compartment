import { z } from 'zod';
import {
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredDescriptorInput,
  compartmentAuthoredDescriptorSchema,
  compartmentProjectNameSchema,
} from './compartment-descriptor.contract';
import { type CompartmentRoutesFile, compartmentRoutesFileSchema } from './compartment-routes.contract';
import { environmentNameSchema } from './deployments.contract';
import type { ContractSchema } from './schema.types';
import { gitSourceDescriptorPathSchema } from './source-git-sync-path.contract';
import { logicalSourceDigestSchema } from './source-uploads.contract';

export interface WorkerClaimedGitSourceResolutionTask {
  branchName: string;
  commitSha: string;
  descriptorPath: string;
  installationToken: string;
  projectName: string;
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
  sourceBindingId: string;
  sourceEventId: string;
  sourceId: string;
  targetEnvironmentName: string;
  taskId: string;
}

export interface WorkerClaimGitSourceResolutionTaskResponse {
  task: WorkerClaimedGitSourceResolutionTask | null;
}

export interface WorkerCompleteGitSourceResolutionTaskRequest {
  descriptor: CompartmentAuthoredDescriptor;
  routes?: CompartmentRoutesFile | undefined;
  taskId: string;
}

export interface WorkerCompleteGitSourceResolutionTaskRequestInput {
  descriptor: CompartmentAuthoredDescriptorInput;
  routes?: CompartmentRoutesFile | undefined;
  taskId: string;
}

export interface WorkerFailGitSourceResolutionTaskRequest {
  failureReason: string;
  retryable: boolean;
  taskId: string;
}

export interface WorkerUploadGitSourceResolutionTaskArchiveResponse {
  success: true;
}

export interface WorkerUploadGitSourceResolutionTaskArchiveQuery {
  sourceDigest: string;
}

export const compartmentGitHubSourceWebhookPathnameTemplate: string =
  '/v1/sources/git/providers/github/organizations/:organizationId/registrations/:registrationId/webhook';
export const workerClaimNextGitSourceResolutionTaskPathname: string =
  '/internal/git-source-resolution-tasks/claim-next';
export const workerCompleteGitSourceResolutionTaskPathname: string = '/internal/git-source-resolution-tasks/complete';
export const workerFailGitSourceResolutionTaskPathname: string = '/internal/git-source-resolution-tasks/fail';
export const workerUploadGitSourceResolutionTaskArchivePathnameTemplate: string =
  '/internal/git-source-resolution-tasks/:taskId/source-archive';

const workerClaimedGitSourceResolutionTaskSchema: ContractSchema<WorkerClaimedGitSourceResolutionTask> = z
  .object({
    branchName: z.string().min(1),
    commitSha: z.string().min(1),
    descriptorPath: gitSourceDescriptorPathSchema,
    installationToken: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    providerHost: z.string().min(1),
    repositoryName: z.string().min(1),
    repositoryOwner: z.string().min(1),
    sourceBindingId: z.string().min(1),
    sourceEventId: z.string().min(1),
    sourceId: z.string().min(1),
    targetEnvironmentName: environmentNameSchema,
    taskId: z.string().min(1),
  })
  .strict();

export const workerClaimGitSourceResolutionTaskResponseSchema: ContractSchema<WorkerClaimGitSourceResolutionTaskResponse> =
  z
    .object({
      task: workerClaimedGitSourceResolutionTaskSchema.nullable(),
    })
    .strict();

export const workerCompleteGitSourceResolutionTaskRequestSchema: ContractSchema<
  WorkerCompleteGitSourceResolutionTaskRequest,
  WorkerCompleteGitSourceResolutionTaskRequestInput
> = z
  .object({
    descriptor: compartmentAuthoredDescriptorSchema,
    routes: compartmentRoutesFileSchema.optional(),
    taskId: z.string().min(1),
  })
  .strict();

export const workerFailGitSourceResolutionTaskRequestSchema: ContractSchema<WorkerFailGitSourceResolutionTaskRequest> =
  z
    .object({
      failureReason: z.string().min(1),
      retryable: z.boolean(),
      taskId: z.string().min(1),
    })
    .strict();

export const workerUploadGitSourceResolutionTaskArchiveResponseSchema: ContractSchema<WorkerUploadGitSourceResolutionTaskArchiveResponse> =
  z
    .object({
      success: z.literal(true),
    })
    .strict();

export const workerUploadGitSourceResolutionTaskArchiveQuerySchema: ContractSchema<WorkerUploadGitSourceResolutionTaskArchiveQuery> =
  z
    .object({
      sourceDigest: logicalSourceDigestSchema,
    })
    .strict();

export function buildWorkerUploadGitSourceResolutionTaskArchivePath(taskId: string, sourceDigest: string): string {
  return `/internal/git-source-resolution-tasks/${encodeURIComponent(taskId)}/source-archive?${new URLSearchParams({ sourceDigest }).toString()}`;
}
