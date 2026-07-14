import type { GitProviderRegistrationSummary, GitProviderRepositorySummary } from '@compartment/contracts';
import type { AuthenticatedContext } from '../../services/context.types';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import { createGitLabSourceRegistration, listGitProviderRepositoriesForSource } from '../../services/sources.service';
import type { GitSourceRepositorySelection } from './source-connect-git-provider.types';

interface GitLabRegistrationRepositorySelection {
  registration: GitProviderRegistrationSummary;
  repository: GitProviderRepositorySummary;
}

export async function resolveGitLabRepositorySelection(
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  token: string | undefined,
  registrations: GitProviderRegistrationSummary[],
): Promise<GitSourceRepositorySelection> {
  const fullName: string = `${plan.repositoryOwner}/${plan.repositoryName}`;
  const selection: GitLabRegistrationRepositorySelection =
    token === undefined
      ? await findGitLabRepositoryWithoutToken(context, plan.providerHost, registrations, fullName)
      : await findGitLabRepositoryAfterRegistration(
          context,
          (await createGitLabSourceRegistration(context, plan.providerHost, token)).registration,
          registrations,
          fullName,
        );
  return {
    providerHost: plan.providerHost,
    registrationId: selection.registration.registrationId,
    repository: selection.repository,
  };
}

async function findGitLabRepositoryAfterRegistration(
  context: AuthenticatedContext,
  created: GitProviderRegistrationSummary,
  registrations: GitProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const candidates: GitProviderRegistrationSummary[] = [
    created,
    ...registrations.filter(
      (registration: GitProviderRegistrationSummary): boolean =>
        registration.providerType === 'gitlab' &&
        registration.providerHost === created.providerHost &&
        registration.registrationId !== created.registrationId,
    ),
  ];
  return await tryGitLabRegistrations(context, candidates, fullName);
}

async function findGitLabRepositoryWithoutToken(
  context: AuthenticatedContext,
  providerHost: string,
  registrations: GitProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const matchingRegistrations: GitProviderRegistrationSummary[] = registrations.filter(
    (registration: GitProviderRegistrationSummary): boolean =>
      registration.providerType === 'gitlab' && registration.providerHost === providerHost,
  );
  if (matchingRegistrations.length === 0) {
    throw new Error(`No GitLab registration exists for ${providerHost}. Set COMPARTMENT_GITLAB_TOKEN and retry.`);
  }

  return await tryGitLabRegistrations(context, matchingRegistrations, fullName);
}

async function tryGitLabRegistrations(
  context: AuthenticatedContext,
  registrations: GitProviderRegistrationSummary[],
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const outcomes: string[] = [];
  for (const registration of registrations) {
    try {
      const selection: GitLabRegistrationRepositorySelection = await findRegisteredGitLabRepository(
        context,
        registration,
        fullName,
      );
      return selection;
    } catch (error) {
      outcomes.push(`${registration.registrationId}: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
  }
  throw new Error(`Could not select GitLab repository ${fullName}. Registration outcomes: ${outcomes.join('; ')}`);
}

async function findRegisteredGitLabRepository(
  context: AuthenticatedContext,
  registration: GitProviderRegistrationSummary,
  fullName: string,
): Promise<GitLabRegistrationRepositorySelection> {
  const repositories: GitProviderRepositorySummary[] = (
    await listGitProviderRepositoriesForSource(context, registration.registrationId)
  ).repositories;
  const repository: GitProviderRepositorySummary | undefined = repositories.find(
    (candidate: GitProviderRepositorySummary): boolean => candidate.fullName === fullName,
  );
  if (repository === undefined) {
    throw new Error(
      `Repository ${fullName} is not available to this registration; check project access and token scope.`,
    );
  }
  return { registration, repository };
}
