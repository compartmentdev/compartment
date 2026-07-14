import type {
  CreateGitDescriptorPullRequestRequest,
  GitDescriptorPullRequestStatusRequest,
} from '@compartment/contracts';
import { throwGitProviderBusinessError } from './git-source-provider-error.service';
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
      buildOperationRepositoryRef(input.request, input.access.registration.providerHost),
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
      buildOperationRepositoryRef(input.request, input.access.registration.providerHost),
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
  throwGitProviderBusinessError(adapter, error, message);
}

function buildOperationRepositoryRef(request: DescriptorRepositoryRefRequest, providerHost: string): GitRepositoryRef {
  return {
    name: request.repositoryName,
    owner: request.repositoryOwner,
    providerHost,
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
