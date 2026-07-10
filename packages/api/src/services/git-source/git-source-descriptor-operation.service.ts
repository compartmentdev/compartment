import type {
  CreateGitDescriptorPullRequestRequest,
  GitDescriptorPullRequestStatusRequest,
} from '@compartment/contracts';
import {
  createGitSourceRepositoryAccessDeniedError,
  createGitSourceRepositoryEmptyError,
} from '../../errors/api-business-error';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type {
  CreateDescriptorPullRequestPlan,
  GitProviderAccess,
  GitProviderAdapter,
  GitPullRequestRef,
  GitPullRequestStatus,
  GitRepositoryRef,
} from './git-source-provider.types';

interface CreateDescriptorPullRequestInput {
  access: GitProviderAccess;
  request: CreateGitDescriptorPullRequestRequest;
}

interface ReadDescriptorPullRequestStatusInput {
  access: GitProviderAccess;
  request: GitDescriptorPullRequestStatusRequest;
}

interface DescriptorRepositoryRefRequest {
  providerHost: string;
  repositoryName: string;
  repositoryOwner: string;
}

export async function createDescriptorPullRequest(input: CreateDescriptorPullRequestInput): Promise<GitPullRequestRef> {
  const adapter: GitProviderAdapter = getGitProviderAdapter(input.access.registration.providerType);
  try {
    return await adapter.createDescriptorPullRequest(
      input.access,
      buildOperationRepositoryRef(input.request),
      buildDescriptorPullRequestPlan(input.request),
    );
  } catch (error) {
    throwGitDescriptorAccessFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository pull request could not be created.',
    );
  }
}

export async function readDescriptorPullRequestStatus(
  input: ReadDescriptorPullRequestStatusInput,
): Promise<GitPullRequestStatus> {
  const adapter: GitProviderAdapter = getGitProviderAdapter(input.access.registration.providerType);
  try {
    return await adapter.readDescriptorPullRequestStatus(
      input.access,
      buildOperationRepositoryRef(input.request),
      input.request.pullRequestNumber,
    );
  } catch (error) {
    throwGitDescriptorAccessFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository pull request could not be read.',
    );
  }
}

export function throwGitDescriptorAccessFailure(
  adapter: GitProviderAdapter,
  error: Error | undefined,
  message: string,
): never {
  if (adapter.isRepositoryEmptyFailure(error)) {
    throw createGitSourceRepositoryEmptyError();
  }
  if (adapter.isRepositoryAccessFailure(error)) {
    throw createGitSourceRepositoryAccessDeniedError(message);
  }
  throw error ?? new Error('Git descriptor operation failed.');
}

function buildOperationRepositoryRef(request: DescriptorRepositoryRefRequest): GitRepositoryRef {
  return {
    name: request.repositoryName,
    owner: request.repositoryOwner,
    providerHost: request.providerHost,
  };
}

function buildDescriptorPullRequestPlan(
  request: CreateGitDescriptorPullRequestRequest,
): CreateDescriptorPullRequestPlan {
  return {
    baseBranchName: request.branchName,
    descriptorPath: request.descriptorPath,
    files: request.files,
    projectName: request.projectName,
  };
}
