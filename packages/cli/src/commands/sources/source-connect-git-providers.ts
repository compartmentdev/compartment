import type {
  GitHubProviderBootstrapResponse,
  GitProviderRegistrationSummary,
  GitProviderRepositorySummary,
  GitProviderType,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { promptVisibleText } from '../../prompts/prompt';
import { readGitProviderRepositoriesForSelection } from './source-connect-git-repository-list';
import { waitForGitHubSourceBootstrap } from './source-connect-git-bootstrap.command';
import { resolveGitLabRepositorySelection } from './source-connect-gitlab.command';
import type {
  GitSourceProviderDescriptor,
  GitSourceProviderOption,
  GitSourceRepositorySelection,
  GitSourceSelectionInput,
} from './source-connect-git-provider.types';

const descriptors: Record<GitSourceProviderOption, GitSourceProviderDescriptor> = {
  github: { providerType: 'github_app', selectRepository: selectGitHubRepository },
  gitlab: { providerType: 'gitlab', selectRepository: selectGitLabRepository },
};

export function resolveGitSourceProvider(
  providerHost: string,
  explicitProvider: string | undefined,
  registrations: GitProviderRegistrationSummary[],
): GitSourceProviderDescriptor {
  if (explicitProvider !== undefined) return readExplicitProvider(explicitProvider);
  const providerTypes: Set<GitProviderType> = new Set<GitProviderType>(
    registrations
      .filter((registration: GitProviderRegistrationSummary): boolean => registration.providerHost === providerHost)
      .map((registration: GitProviderRegistrationSummary): GitProviderType => registration.providerType),
  );
  if (providerTypes.size === 1) return readDescriptorByType([...providerTypes][0]!);
  if (providerTypes.size > 1) throw new Error(`Host ${providerHost} has multiple provider types: pass --provider.`);
  if (providerHost === 'github.com') return descriptors.github;
  if (providerHost === 'gitlab.com') return descriptors.gitlab;
  throw new Error(`Unknown host ${providerHost}: pass --provider or register the provider first.`);
}

function readExplicitProvider(value: string): GitSourceProviderDescriptor {
  if (!Object.hasOwn(descriptors, value))
    throw new Error(`Unknown provider ${value}: pass --provider github or --provider gitlab.`);
  return descriptors[value as GitSourceProviderOption];
}

function readDescriptorByType(providerType: GitProviderType): GitSourceProviderDescriptor {
  const descriptor: GitSourceProviderDescriptor | undefined = Object.values(descriptors).find(
    (candidate: GitSourceProviderDescriptor): boolean => candidate.providerType === providerType,
  );
  if (descriptor === undefined) throw new Error(`Unsupported provider type ${providerType}.`);
  return descriptor;
}

async function selectGitLabRepository(input: GitSourceSelectionInput): Promise<GitSourceRepositorySelection> {
  return await resolveGitLabRepositorySelection(
    input.context,
    input.plan,
    readGitLabAccessToken(),
    input.registrations,
  );
}

async function selectGitHubRepository(input: GitSourceSelectionInput): Promise<GitSourceRepositorySelection> {
  const requestedOwner: string = await promptVisibleText(
    input.dependencies.io,
    'GitHub account or organization',
    input.plan.repositoryOwner,
  );
  const bootstrap: GitHubProviderBootstrapResponse = await waitForGitHubSourceBootstrap(
    input.dependencies,
    input.context,
    { providerHost: input.plan.providerHost, repositoryOwner: requestedOwner },
  );
  const owner: string = hasText(bootstrap.installationAccountLogin)
    ? bootstrap.installationAccountLogin
    : requestedOwner;
  const repositories: GitProviderRepositorySummary[] = await readGitHubRepositories(input, bootstrap.registrationId);
  if (repositories.length === 0) throw new Error('GitHub App installation does not include any repositories.');
  const repository: GitProviderRepositorySummary = await promptForRepositorySelection(
    input,
    repositories,
    `${owner}/${input.plan.repositoryName}`,
  );
  return { providerHost: bootstrap.providerHost, registrationId: bootstrap.registrationId, repository };
}

async function readGitHubRepositories(
  input: GitSourceSelectionInput,
  registrationId: string,
): Promise<GitProviderRepositorySummary[]> {
  return await readGitProviderRepositoriesForSelection(input.context, registrationId);
}

async function promptForRepositorySelection(
  input: GitSourceSelectionInput,
  repositories: GitProviderRepositorySummary[],
  preferredFullName: string,
): Promise<GitProviderRepositorySummary> {
  input.dependencies.io.stderr(`Available repositories:\n${repositories.map(formatRepositoryListItem).join('\n')}\n`);
  const preferred: GitProviderRepositorySummary | undefined = repositories.find(
    (repository: GitProviderRepositorySummary): boolean => repository.fullName === preferredFullName,
  );
  const defaultFullName: string = (preferred ?? repositories[0]!).fullName;
  for (;;) {
    const fullName: string = await promptVisibleText(input.dependencies.io, 'Repository', defaultFullName);
    const repository: GitProviderRepositorySummary | undefined = repositories.find(
      (candidate: GitProviderRepositorySummary): boolean => candidate.fullName === fullName,
    );
    if (repository !== undefined) return repository;
    input.dependencies.io.stderr('Select one of the listed repositories by full name.\n');
  }
}

function formatRepositoryListItem(repository: GitProviderRepositorySummary): string {
  return `- ${repository.fullName}\tdefault branch: ${repository.defaultBranchName}`;
}

function readGitLabAccessToken(): string | undefined {
  const token: string | undefined = process.env.COMPARTMENT_GITLAB_TOKEN;
  return token === undefined || token.length === 0 ? undefined : token;
}
