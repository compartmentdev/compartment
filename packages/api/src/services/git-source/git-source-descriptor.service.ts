import {
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
} from '@compartment/contracts';
import { readGitHubRepositoryContent, readGitHubRepositoryTree } from './github-app-client.adapter';
import type {
  GitHubRepositoryContent,
  GitHubRepositoryPullRequest,
  GitHubRepositoryPullRequestStatus,
  GitHubRepositoryTreeEntry,
} from './github-app-client.adapter.types';
import { buildDescriptorCandidates, readFirstDescriptorPath } from './git-source-descriptor-candidate.service';
import {
  createDescriptorPullRequest,
  readDescriptorPullRequestStatus,
  throwGitDescriptorAccessFailure,
} from './git-source-descriptor-github-operation.service';
import { assertDescriptorPullRequestMatchesPlan } from './git-source-descriptor-plan-validation.service';
import {
  assertGitDescriptorPullRequestStatusToken,
  withGitDescriptorPullRequestStatusToken,
} from './git-source-descriptor-pr-token.service';
import {
  buildGitHubRegistrationClientAuth,
  requireGitHubRegistrationAccess,
  type GitHubRegistrationAccess,
} from './git-source-descriptor-registration-access.service';
import type { GitSourceContextInput } from './git-source.service.types';

interface ReadGitDescriptorPlanInput extends GitSourceContextInput {
  request: GitDescriptorPlanRequest;
}

interface CreateGitDescriptorPullRequestInput extends GitSourceContextInput {
  request: CreateGitDescriptorPullRequestRequest;
}

interface ReadGitDescriptorPullRequestStatusInput extends GitSourceContextInput {
  request: GitDescriptorPullRequestStatusRequest;
}

interface ReadGitHubRepositoryTreeInput {
  access: GitHubRegistrationAccess;
  branchName: string;
  repositoryName: string;
  repositoryOwner: string;
}

export async function readGitDescriptorPlan(input: ReadGitDescriptorPlanInput): Promise<GitDescriptorPlanResponse> {
  const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess({
    ...input,
    providerHost: input.request.providerHost,
    registrationId: input.request.registrationId,
    repositoryOwner: input.request.repositoryOwner,
  });
  const tree: GitHubRepositoryTreeEntry[] = await readDescriptorPlanTree({
    access,
    branchName: input.request.branchName,
    repositoryName: input.request.repositoryName,
    repositoryOwner: input.request.repositoryOwner,
  });
  const descriptorPath: string | null = readFirstDescriptorPath(tree);
  if (descriptorPath !== null) {
    return await buildExistingDescriptorPlan(input.request, access, descriptorPath);
  }

  return buildMissingDescriptorPlan(input.request, tree);
}

function buildMissingDescriptorPlan(
  input: GitDescriptorPlanRequest,
  tree: GitHubRepositoryTreeEntry[],
): GitDescriptorPlanResponse {
  return {
    branchName: input.branchName,
    candidates: buildDescriptorCandidates(input.repositoryName, tree),
    descriptorPath: null,
    preview: null,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    status: 'descriptor_missing',
  };
}

export async function createGitDescriptorPullRequest(
  input: CreateGitDescriptorPullRequestInput,
): Promise<GitDescriptorPullRequestResponse> {
  const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess({
    ...input,
    providerHost: input.request.providerHost,
    registrationId: input.request.registrationId,
    repositoryOwner: input.request.repositoryOwner,
  });
  assertDescriptorPullRequestMatchesPlan(
    input.request,
    await readDescriptorPlanTree({
      access,
      branchName: input.request.branchName,
      repositoryName: input.request.repositoryName,
      repositoryOwner: input.request.repositoryOwner,
    }),
  );
  const pullRequest: GitHubRepositoryPullRequest = await createDescriptorPullRequest({
    access,
    request: input.request,
  });

  return toGitDescriptorPullRequestResponse(input.request, pullRequest);
}

function toGitDescriptorPullRequestResponse(
  input: CreateGitDescriptorPullRequestRequest,
  pullRequest: GitHubRepositoryPullRequest,
): GitDescriptorPullRequestResponse {
  return withGitDescriptorPullRequestStatusToken(
    {
      providerHost: input.providerHost,
      pullRequestNumber: pullRequest.number,
      registrationId: input.registrationId,
      repositoryName: input.repositoryName,
      repositoryOwner: input.repositoryOwner,
    },
    {
      descriptorPath: input.descriptorPath,
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.htmlUrl,
      state: pullRequest.state,
    },
  );
}

async function readDescriptorPlanTree(input: ReadGitHubRepositoryTreeInput): Promise<GitHubRepositoryTreeEntry[]> {
  try {
    return await readGitHubRepositoryTree({
      ...buildGitHubRegistrationClientAuth(input.access),
      branchName: input.branchName,
      owner: input.repositoryOwner,
      repositoryName: input.repositoryName,
    });
  } catch (error) {
    throwGitDescriptorAccessFailure(
      error instanceof Error ? error : undefined,
      'The selected repository branch could not be read.',
    );
  }
}

export async function readGitDescriptorPullRequestStatus(
  input: ReadGitDescriptorPullRequestStatusInput,
): Promise<GitDescriptorPullRequestStatusResponse> {
  assertGitDescriptorPullRequestStatusToken(input.request);
  const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess({
    ...input,
    providerHost: input.request.providerHost,
    registrationId: input.request.registrationId,
    repositoryOwner: input.request.repositoryOwner,
  });
  const pullRequest: GitHubRepositoryPullRequestStatus = await readDescriptorPullRequestStatus({
    access,
    request: input.request,
  });

  return {
    pullRequestNumber: input.request.pullRequestNumber,
    pullRequestUrl: pullRequest.htmlUrl,
    state: pullRequest.merged ? 'merged' : pullRequest.state,
  };
}

async function buildExistingDescriptorPlan(
  input: GitDescriptorPlanRequest,
  access: GitHubRegistrationAccess,
  descriptorPath: string,
): Promise<GitDescriptorPlanResponse> {
  const content: GitHubRepositoryContent = await readExistingDescriptorContent(input, access, descriptorPath);

  return {
    branchName: input.branchName,
    candidates: [],
    descriptorPath,
    preview: content.content,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    status: 'descriptor_found',
  };
}

async function readExistingDescriptorContent(
  input: GitDescriptorPlanRequest,
  access: GitHubRegistrationAccess,
  descriptorPath: string,
): Promise<GitHubRepositoryContent> {
  try {
    return await readGitHubRepositoryContent({
      ...buildGitHubRegistrationClientAuth(access),
      branchName: input.branchName,
      owner: input.repositoryOwner,
      path: descriptorPath,
      repositoryName: input.repositoryName,
    });
  } catch (error) {
    throwGitDescriptorAccessFailure(
      error instanceof Error ? error : undefined,
      'The selected repository branch could not be read.',
    );
  }
}
