import {
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusRequest,
  type GitDescriptorPullRequestStatusResponse,
} from '@compartment/contracts';
import { buildDescriptorCandidates, readFirstDescriptorPath } from './git-source-descriptor-candidate.service';
import {
  createDescriptorPullRequest,
  readDescriptorPullRequestStatus,
  throwGitDescriptorAccessFailure,
} from './git-source-descriptor-operation.service';
import { assertDescriptorPullRequestMatchesPlan } from './git-source-descriptor-plan-validation.service';
import {
  assertGitDescriptorPullRequestStatusToken,
  withGitDescriptorPullRequestStatusToken,
} from './git-source-descriptor-pr-token.service';
import { requireGitProviderRegistrationAccess } from './git-source-descriptor-registration-access.service';
import { getGitProviderAdapter } from './git-source-provider.registry';
import type {
  GitProviderAccess,
  GitProviderAdapter,
  GitPullRequestRef,
  GitPullRequestStatus,
  GitRepositoryFile,
  GitRepositoryRef,
  GitRepositoryTreeEntry,
} from './git-source-provider.types';
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

interface ReadDescriptorTreeInput {
  access: GitProviderAccess;
  branchName: string;
  repositoryName: string;
  repositoryOwner: string;
}

export async function readGitDescriptorPlan(input: ReadGitDescriptorPlanInput): Promise<GitDescriptorPlanResponse> {
  const access: GitProviderAccess = await requireGitProviderRegistrationAccess({
    ...input,
    providerHost: input.request.providerHost,
    registrationId: input.request.registrationId,
    repositoryOwner: input.request.repositoryOwner,
  });
  const tree: GitRepositoryTreeEntry[] = await readDescriptorPlanTree({
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
  tree: GitRepositoryTreeEntry[],
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
  const access: GitProviderAccess = await requireGitProviderRegistrationAccess({
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
  const pullRequest: GitPullRequestRef = await createDescriptorPullRequest({
    access,
    request: input.request,
  });

  return toGitDescriptorPullRequestResponse(input.request, pullRequest);
}

function toGitDescriptorPullRequestResponse(
  input: CreateGitDescriptorPullRequestRequest,
  pullRequest: GitPullRequestRef,
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

async function readDescriptorPlanTree(input: ReadDescriptorTreeInput): Promise<GitRepositoryTreeEntry[]> {
  const adapter: GitProviderAdapter = getGitProviderAdapter(input.access.registration.providerType);
  try {
    return await adapter.readRepositoryTree(
      input.access,
      buildDescriptorRepositoryRef(input.access, input.repositoryOwner, input.repositoryName),
      input.branchName,
    );
  } catch (error) {
    throwGitDescriptorAccessFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository branch could not be read.',
    );
  }
}

export async function readGitDescriptorPullRequestStatus(
  input: ReadGitDescriptorPullRequestStatusInput,
): Promise<GitDescriptorPullRequestStatusResponse> {
  assertGitDescriptorPullRequestStatusToken(input.request);
  const access: GitProviderAccess = await requireGitProviderRegistrationAccess({
    ...input,
    providerHost: input.request.providerHost,
    registrationId: input.request.registrationId,
    repositoryOwner: input.request.repositoryOwner,
  });
  const pullRequest: GitPullRequestStatus = await readDescriptorPullRequestStatus({
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
  access: GitProviderAccess,
  descriptorPath: string,
): Promise<GitDescriptorPlanResponse> {
  const content: GitRepositoryFile = await readExistingDescriptorContent(input, access, descriptorPath);

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
  access: GitProviderAccess,
  descriptorPath: string,
): Promise<GitRepositoryFile> {
  const adapter: GitProviderAdapter = getGitProviderAdapter(access.registration.providerType);
  try {
    return await adapter.readRepositoryFile(
      access,
      buildDescriptorRepositoryRef(access, input.repositoryOwner, input.repositoryName),
      input.branchName,
      descriptorPath,
    );
  } catch (error) {
    throwGitDescriptorAccessFailure(
      adapter,
      error instanceof Error ? error : undefined,
      'The selected repository branch could not be read.',
    );
  }
}

function buildDescriptorRepositoryRef(
  access: GitProviderAccess,
  repositoryOwner: string,
  repositoryName: string,
): GitRepositoryRef {
  return {
    name: repositoryName,
    owner: repositoryOwner,
    providerHost: access.registration.providerHost,
  };
}
