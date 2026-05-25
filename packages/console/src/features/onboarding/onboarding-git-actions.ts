import type {
  GitDescriptorPullRequestResponse,
  GitDescriptorPullRequestStatusResponse,
} from '@compartment/contracts/browser';
import { createBrowserGitDescriptorPullRequest, readBrowserGitDescriptorPullRequestStatus } from './onboarding-git-api';
import { gitOnboardingProviderHost } from './onboarding-git-constants';
import { connectOrAdoptGitSource, type GitSourceConnectionResult } from './onboarding-git-source-connection';
import type { GitDescriptorLoadResult, GitOnboardingState } from './onboarding-git-state';
import type { GitConnectFormInput, GitDescriptorTargetOption } from './onboarding-page.types';

export type GitRepositorySelectionResult =
  | GitRepositoryConnectedSelectionResult
  | GitRepositoryDescriptorRequiredSelectionResult;

export interface GitPullRequestRefreshContext {
  descriptorPath: string;
  pullRequestNumber: number;
  statusToken: string;
}

interface GitRepositoryConnectedSelectionResult {
  connection: GitSourceConnectionResult;
  descriptorPath: string | undefined;
  kind: 'connected';
}

interface GitRepositoryDescriptorRequiredSelectionResult {
  kind: 'descriptor_required';
}

export async function handleRepositorySelected(
  selectedOrganizationSlug: string,
  state: GitOnboardingState,
  formInput: GitConnectFormInput,
): Promise<GitRepositorySelectionResult> {
  const plan: GitDescriptorLoadResult = await state.loadDescriptorTargets();
  if (plan.status === 'descriptor_found') {
    const descriptorPath: string | undefined = readExistingDescriptorPath(plan);
    return {
      connection: await connectOrAdoptGitSource(selectedOrganizationSlug, formInput, descriptorPath),
      descriptorPath,
      kind: 'connected',
    };
  }

  return { kind: 'descriptor_required' };
}

export async function handleCreatePullRequest(
  selectedOrganizationSlug: string,
  formInput: GitConnectFormInput,
  target: GitDescriptorTargetOption,
): Promise<GitDescriptorPullRequestResponse> {
  return await createBrowserGitDescriptorPullRequest(selectedOrganizationSlug, {
    appFolder: target.directory,
    branchName: formInput.branchName,
    descriptorPath: target.descriptorPath,
    files: target.files,
    projectName: target.projectName,
    providerHost: gitOnboardingProviderHost,
    registrationId: formInput.repository.registrationId,
    repositoryName: formInput.repository.name,
    repositoryOwner: formInput.repository.owner,
  });
}

export async function handlePullRequestRefresh(
  selectedOrganizationSlug: string,
  formInput: GitConnectFormInput,
  context: GitPullRequestRefreshContext,
): Promise<GitDescriptorPullRequestStatusResponse> {
  return await readBrowserGitDescriptorPullRequestStatus(selectedOrganizationSlug, {
    providerHost: gitOnboardingProviderHost,
    pullRequestNumber: context.pullRequestNumber,
    registrationId: formInput.repository.registrationId,
    repositoryName: formInput.repository.name,
    repositoryOwner: formInput.repository.owner,
    statusToken: context.statusToken,
  });
}

export async function connectSelectedGitSource(
  selectedOrganizationSlug: string,
  formInput: GitConnectFormInput,
  descriptorPath: string | undefined,
): Promise<GitSourceConnectionResult> {
  return await connectOrAdoptGitSource(selectedOrganizationSlug, formInput, descriptorPath);
}

function readExistingDescriptorPath(plan: GitDescriptorLoadResult): string | undefined {
  return plan.targets[0]?.descriptorPath;
}
