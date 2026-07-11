import type { GitHubInstallationRepositorySummary, GitLabProviderRegistrationSummary } from '@compartment/contracts';
import type { AuthenticatedContext } from '../../services/context.types';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import {
  createGitLabSourceRegistration,
  listGitLabRepositoriesForSource,
  listGitLabSourceRegistrations,
} from '../../services/sources.service';

interface GitLabRepositorySelection {
  providerHost: string;
  registrationId: string;
  repository: GitHubInstallationRepositorySummary;
}

export async function resolveGitLabRepositorySelection(
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  token: string | undefined,
): Promise<GitLabRepositorySelection> {
  const existing: GitLabProviderRegistrationSummary | undefined = (
    await listGitLabSourceRegistrations(context)
  ).registrations.find(
    (registration: GitLabProviderRegistrationSummary): boolean => registration.providerHost === plan.providerHost,
  );
  const registration: GitLabProviderRegistrationSummary =
    token === undefined
      ? requireGitLabRegistration(existing)
      : (await createGitLabSourceRegistration(context, plan.providerHost, token)).registration;
  const repositories: GitHubInstallationRepositorySummary[] = (
    await listGitLabRepositoriesForSource(context, registration.registrationId)
  ).repositories;
  const repository: GitHubInstallationRepositorySummary | undefined =
    repositories.find(
      (candidate: GitHubInstallationRepositorySummary): boolean =>
        candidate.fullName === `${plan.repositoryOwner}/${plan.repositoryName}`,
    ) ?? repositories[0];
  if (repository === undefined) throw new Error('GitLab registration does not include any repositories.');
  return { providerHost: plan.providerHost, registrationId: registration.registrationId, repository };
}

export async function isGitLabRepositoryProvider(
  context: AuthenticatedContext,
  providerHost: string,
  token: string | undefined,
): Promise<boolean> {
  if (providerHost === 'github.com') return false;
  if (token !== undefined) return true;
  return (await listGitLabSourceRegistrations(context)).registrations.some(
    (registration: GitLabProviderRegistrationSummary): boolean => registration.providerHost === providerHost,
  );
}

function requireGitLabRegistration(
  registration: GitLabProviderRegistrationSummary | undefined,
): GitLabProviderRegistrationSummary {
  if (registration === undefined) {
    throw new Error('Set COMPARTMENT_GITLAB_TOKEN to register GitLab.');
  }
  return registration;
}
