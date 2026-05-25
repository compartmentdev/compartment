import type { GitSourceResponse } from '@compartment/contracts/browser';
import { connectBrowserGitSource } from './onboarding-git-api';
import { gitOnboardingProviderHost } from './onboarding-git-constants';
import type { GitConnectFormInput } from './onboarding-page.types';

export interface GitSourceConnectionResult {
  sourceId: string;
  syncTaskId: string | undefined;
}

export async function connectOrAdoptGitSource(
  selectedOrganizationSlug: string,
  formInput: GitConnectFormInput,
  descriptorPath: string | undefined,
): Promise<GitSourceConnectionResult> {
  const response: GitSourceResponse = await connectBrowserGitSource(selectedOrganizationSlug, {
    autoAdoptNewApps: true,
    defaultAutoDeployEnabled: true,
    defaultEnvironmentName: formInput.environmentName,
    ...(descriptorPath !== undefined ? { descriptorPathToInclude: descriptorPath } : {}),
    providerHost: gitOnboardingProviderHost,
    repositoryName: formInput.repository.name,
    repositoryOwner: formInput.repository.owner,
    syncBranchName: formInput.branchName,
  });
  return {
    sourceId: response.source.id,
    syncTaskId: response.source.latestSync?.id,
  };
}
