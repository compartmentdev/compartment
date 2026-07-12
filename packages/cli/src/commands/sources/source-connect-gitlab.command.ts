import type { GitLabProviderRegistrationSummary, GitProviderRepositorySummary } from '@compartment/contracts';
import type { AuthenticatedContext } from '../../services/context.types';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import { createGitLabSourceRegistration, listGitLabRepositoriesForSource } from '../../services/sources.service';

interface GitLabRepositorySelection {
  providerHost: string;
  registrationId: string;
  repository: GitProviderRepositorySummary;
}

interface GitLabRegistrationRepositorySelection {
  registration: GitLabProviderRegistrationSummary;
  repository: GitProviderRepositorySummary;
}

export async function resolveGitLabRepositorySelection(
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
): Promise<GitLabRepositorySelection> {
  const fullName: string = `${plan.repositoryOwner}/${plan.repositoryName}`;
  const selection: GitLabRegistrationRepositorySelection = await resolveGitLabRegistrationForRepository(
    context,
    plan.providerHost,
    token,
    registrations,
    fullName,
  );
  return buildGitLabRepositorySelection(plan.providerHost, selection.registration.registrationId, selection.repository);
}

function buildGitLabRepositorySelection(
  providerHost: string,
  registrationId: string,
  repository: GitProviderRepositorySummary,
): GitLabRepositorySelection {
  return { providerHost, registrationId, repository };
}

async function resolveGitLabRegistrationForRepository(
  context: AuthenticatedContext,
  providerHost: string,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  if (token !== undefined) {
    const registration: GitLabProviderRegistrationSummary = await resolveGitLabRegistration(
      context,
      providerHost,
      token,
    );
    return await findRegisteredGitLabRepository(context, registration, fullName);
  }
  return await findGitLabRepositoryWithoutToken(context, providerHost, registrations, fullName);
}

async function findGitLabRepositoryWithoutToken(
  context: AuthenticatedContext,
  providerHost: string,
  registrations: GitLabProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const matchingRegistrations: GitLabProviderRegistrationSummary[] = registrations.filter(
    (candidate: GitLabProviderRegistrationSummary): boolean => candidate.providerHost === providerHost,
  );
  for (const registration of matchingRegistrations) {
    const repositories: GitProviderRepositorySummary[] = (
      await listGitLabRepositoriesForSource(context, registration.registrationId)
    ).repositories;
    const repository: GitProviderRepositorySummary | undefined = repositories.find(
      (candidate: GitProviderRepositorySummary): boolean => candidate.fullName === fullName,
    );
    if (repository !== undefined) return { registration, repository };
  }
  if (matchingRegistrations.length === 0) throw new Error('Set COMPARTMENT_GITLAB_TOKEN to register GitLab.');
  throw new Error(`GitLab repository ${fullName} was not found for a registration on ${providerHost}.`);
}

async function resolveGitLabRegistration(
  context: AuthenticatedContext,
  providerHost: string,
  token: string,
): Promise<GitLabProviderRegistrationSummary> {
  return (await createGitLabSourceRegistration(context, providerHost, token)).registration;
}

export function isGitLabRepositoryProvider(
  providerHost: string,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
  activeGitHubProviderHosts: string[],
): boolean {
  if (providerHost === 'gitlab.com') return true;
  if (providerHost === 'github.com') return false;
  const hasActiveGitLabRegistration: boolean = registrations.some(
    (registration: GitLabProviderRegistrationSummary): boolean => registration.providerHost === providerHost,
  );
  if (hasActiveGitLabRegistration) return true;
  return token !== undefined && !activeGitHubProviderHosts.includes(providerHost);
}

async function findRegisteredGitLabRepository(
  context: AuthenticatedContext,
  registration: GitLabProviderRegistrationSummary,
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const repositories: GitProviderRepositorySummary[] = (
    await listGitLabRepositoriesForSource(context, registration.registrationId)
  ).repositories;
  const repository: GitProviderRepositorySummary | undefined = repositories.find(
    (candidate: GitProviderRepositorySummary): boolean => candidate.fullName === fullName,
  );
  if (repository === undefined)
    throw new Error(
      `GitLab repository ${fullName} was not found for the registration on ${registration.providerHost}.`,
    );
  return { registration, repository };
}
