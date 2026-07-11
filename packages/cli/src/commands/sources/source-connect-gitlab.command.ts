import type {
  GitLabProviderRegistrationListResponse,
  GitLabProviderRegistrationSummary,
  GitProviderRepositorySummary,
} from '@compartment/contracts';
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
  repository: GitProviderRepositorySummary;
}

export async function listGitLabRegistrationsForSelection(
  context: AuthenticatedContext,
): Promise<GitLabProviderRegistrationListResponse> {
  return await listGitLabSourceRegistrations(context);
}

export async function resolveGitLabRepositorySelection(
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
): Promise<GitLabRepositorySelection> {
  const fullName: string = `${plan.repositoryOwner}/${plan.repositoryName}`;
  const registration: GitLabProviderRegistrationSummary | undefined = await resolveGitLabRegistrationForRepository(
    context,
    plan.providerHost,
    token,
    registrations,
    fullName,
  );
  if (registration === undefined)
    throw new Error(`GitLab repository ${fullName} was not found for a registration on ${plan.providerHost}.`);
  const repository: GitProviderRepositorySummary = await requireRegisteredGitLabRepository(
    context,
    registration,
    fullName,
  );
  return buildGitLabRepositorySelection(plan.providerHost, registration.registrationId, repository);
}

function buildGitLabRepositorySelection(
  providerHost: string,
  registrationId: string,
  repository: GitProviderRepositorySummary,
): GitLabRepositorySelection {
  return { providerHost, registrationId, repository };
}

async function requireRegisteredGitLabRepository(
  context: AuthenticatedContext,
  registration: GitLabProviderRegistrationSummary,
  fullName: string,
): Promise<GitProviderRepositorySummary> {
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
  return repository;
}

async function resolveGitLabRegistrationForRepository(
  context: AuthenticatedContext,
  providerHost: string,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabProviderRegistrationSummary | undefined> {
  if (token !== undefined) return await resolveGitLabRegistration(context, providerHost, token, registrations);
  for (const registration of registrations.filter(
    (candidate: GitLabProviderRegistrationSummary): boolean => candidate.providerHost === providerHost,
  )) {
    const repositories: GitProviderRepositorySummary[] = (
      await listGitLabRepositoriesForSource(context, registration.registrationId)
    ).repositories;
    if (repositories.some((repository: GitProviderRepositorySummary): boolean => repository.fullName === fullName))
      return registration;
  }
  return undefined;
}

async function resolveGitLabRegistration(
  context: AuthenticatedContext,
  providerHost: string,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
): Promise<GitLabProviderRegistrationSummary> {
  const existing: GitLabProviderRegistrationSummary | undefined = registrations.find(
    (registration: GitLabProviderRegistrationSummary): boolean => registration.providerHost === providerHost,
  );
  return token === undefined
    ? requireGitLabRegistration(existing)
    : (await createGitLabSourceRegistration(context, providerHost, token)).registration;
}

export function isGitLabRepositoryProvider(
  providerHost: string,
  token: string | undefined,
  registrations: GitLabProviderRegistrationSummary[],
  activeGitHubProviderHosts: string[] = [],
): boolean {
  if (providerHost === 'gitlab.com') return true;
  if (providerHost === 'github.com') return false;
  const hasActiveGitLabRegistration: boolean = registrations.some(
    (registration: GitLabProviderRegistrationSummary): boolean => registration.providerHost === providerHost,
  );
  if (hasActiveGitLabRegistration) return true;
  return token !== undefined && !activeGitHubProviderHosts.includes(providerHost);
}

function requireGitLabRegistration(
  registration: GitLabProviderRegistrationSummary | undefined,
): GitLabProviderRegistrationSummary {
  if (registration === undefined) {
    throw new Error('Set COMPARTMENT_GITLAB_TOKEN to register GitLab.');
  }
  return registration;
}
