import type { GitPullRequestRefreshContext } from './onboarding-git-actions';
import type { GitSourceConnectionResult } from './onboarding-git-source-connection';
import type { GitConnectFormInput, OnboardingRouteStatePatch } from './onboarding-page.types';

export interface GitPullRequestMergeInput {
  descriptorPath: string | undefined;
  formInput: GitConnectFormInput;
  pullRequestNumber: number | undefined;
  pullRequestStatusToken: string | undefined;
  selectedOrganizationSlug: string;
}

export function readSelectedRepositoryRoutePatch(formInput: GitConnectFormInput): OnboardingRouteStatePatch {
  return {
    branchName: formInput.branchName,
    environmentName: formInput.environmentName,
    provider: formInput.repository.provider,
    providerHost: formInput.repository.providerHost,
    registrationId: formInput.repository.registrationId,
    repositoryId: formInput.repository.id,
    repositoryName: formInput.repository.name,
    repositoryOwner: formInput.repository.owner,
  };
}

export function readPullRequestRefreshContext(input: GitPullRequestMergeInput): GitPullRequestRefreshContext | null {
  if (
    input.descriptorPath === undefined ||
    input.pullRequestNumber === undefined ||
    input.pullRequestStatusToken === undefined
  ) {
    return null;
  }

  return {
    descriptorPath: input.descriptorPath,
    pullRequestNumber: input.pullRequestNumber,
    statusToken: input.pullRequestStatusToken,
  };
}

export function readMergedPullRequestRoutePatch(
  context: GitPullRequestRefreshContext,
  connection: GitSourceConnectionResult,
): OnboardingRouteStatePatch {
  return {
    descriptorPath: context.descriptorPath,
    pullRequestState: 'merged',
    sourceId: connection.sourceId,
    step: 'deploy',
    syncTaskId: connection.syncTaskId,
  };
}
