import type {
  CreateGitDescriptorPullRequestRequest,
  GitDescriptorPullRequestStatusRequest,
} from '@compartment/contracts';
import {
  createGitSourceRepositoryAccessDeniedError,
  createGitSourceRepositoryEmptyError,
} from '../../errors/api-business-error';
import {
  createGitHubRepositoryDescriptorPullRequest,
  readGitHubRepositoryPullRequestStatus,
} from './github-app-client.adapter';
import type {
  CreateGitHubRepositoryDescriptorPullRequestInput,
  GitHubRepositoryPullRequest,
  GitHubRepositoryPullRequestStatus,
  GitHubRepositoryPullRequestStatusInput,
} from './github-app-client.adapter.types';
import {
  buildGitHubRegistrationClientAuth,
  type GitHubRegistrationAccess,
} from './git-source-descriptor-registration-access.service';
import { isGitHubRepositoryAccessFailure, isGitHubRepositoryEmptyFailure } from './github-app-http.adapter';

interface CreateDescriptorPullRequestInput {
  access: GitHubRegistrationAccess;
  request: CreateGitDescriptorPullRequestRequest;
}

interface ReadDescriptorPullRequestStatusInput {
  access: GitHubRegistrationAccess;
  request: GitDescriptorPullRequestStatusRequest;
}

export async function createDescriptorPullRequest(
  input: CreateDescriptorPullRequestInput,
): Promise<GitHubRepositoryPullRequest> {
  try {
    return await createGitHubRepositoryDescriptorPullRequest(buildCreateGitHubDescriptorPullRequestInput(input));
  } catch (error) {
    throwGitDescriptorAccessFailure(
      error instanceof Error ? error : undefined,
      'The selected repository pull request could not be created.',
    );
  }
}

export async function readDescriptorPullRequestStatus(
  input: ReadDescriptorPullRequestStatusInput,
): Promise<GitHubRepositoryPullRequestStatus> {
  try {
    return await readGitHubRepositoryPullRequestStatus(
      buildReadGitHubPullRequestStatusInput(input.request, input.access),
    );
  } catch (error) {
    throwGitDescriptorAccessFailure(
      error instanceof Error ? error : undefined,
      'The selected repository pull request could not be read.',
    );
  }
}

export function throwGitDescriptorAccessFailure(error: Error | undefined, message: string): never {
  if (isGitHubRepositoryEmptyFailure(error)) {
    throw createGitSourceRepositoryEmptyError();
  }
  if (isGitHubRepositoryAccessFailure(error)) {
    throw createGitSourceRepositoryAccessDeniedError(message);
  }
  throw error ?? new Error('GitHub descriptor operation failed.');
}

function buildCreateGitHubDescriptorPullRequestInput(
  input: CreateDescriptorPullRequestInput,
): CreateGitHubRepositoryDescriptorPullRequestInput {
  return {
    ...buildGitHubRegistrationClientAuth(input.access),
    baseBranchName: input.request.branchName,
    descriptorPath: input.request.descriptorPath,
    files: input.request.files,
    owner: input.request.repositoryOwner,
    projectName: input.request.projectName,
    repositoryName: input.request.repositoryName,
  };
}

function buildReadGitHubPullRequestStatusInput(
  request: GitDescriptorPullRequestStatusRequest,
  access: GitHubRegistrationAccess,
): GitHubRepositoryPullRequestStatusInput {
  return {
    ...buildGitHubRegistrationClientAuth(access),
    owner: request.repositoryOwner,
    pullRequestNumber: request.pullRequestNumber,
    repositoryName: request.repositoryName,
  };
}
