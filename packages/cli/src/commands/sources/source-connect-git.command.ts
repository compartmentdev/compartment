import {
  defaultCompartmentEnvironmentName,
  type GitHubInstallationRepositorySummary,
  type GitHubProviderBootstrapResponse,
  type GitLabProviderRegistrationListResponse,
  type GitProviderRepositorySummary,
  type GitSourceResponse,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { Command } from 'commander';
import { promptVisibleText } from '../../prompts/prompt';
import { connectGitSource, listGitLabSourceRegistrations } from '../../services/sources.service';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, SourceConnectGitCommandOptions } from '../command.types';
import { addRemoteOption } from '../remote.command.helpers';
import { waitForGitHubSourceBootstrap } from './source-connect-git-bootstrap.command';
import {
  formatGitRepositoryListItem,
  readDefaultGitRepositoryFullName,
  readGitHubInstallationRepositoriesForSelection,
  resolveGitRepositoryOwner,
} from './source-connect-git-repository-list';
import { parseEnabledDisabledState, promptYesNoChoice } from './source.command.helpers';
import { isGitLabRepositoryProvider, resolveGitLabRepositorySelection } from './source-connect-gitlab.command';
import { runSourceConnectGitCommand } from './source-connect-git-run.command';

export interface GitSourceRepositorySelection {
  providerHost: string;
  registrationId?: string | undefined;
  repository: GitProviderRepositorySummary;
}

interface ConnectSelectedGitSourceInput {
  autoAdoptNewApps: boolean;
  branchName: string;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  providerHost: string;
  registrationId?: string | undefined;
  repository: GitHubInstallationRepositorySummary;
}

export interface GitSourceConnectionSettings {
  autoAdoptNewApps: boolean;
  branchName: string;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
}

export function registerSourceConnectGitCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('git')
      .option('--all', 'auto-adopt discovered descriptor apps')
      .option('--auto-adopt-new-apps <state>', 'enabled or disabled')
      .option('--auto-deploy', 'enable auto deploy for created bindings')
      .option('--branch <name>', 'branch to map on connect')
      .option('--env <name>', 'environment to map on connect')
      .option('--manual', 'create bindings without auto deploy'),
  ).action(async (options: SourceConnectGitCommandOptions): Promise<void> => {
    await runSourceConnectGitCommand(dependencies, options);
  });
}

export async function resolveGitSourceConnectionSettings(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
  defaultBranchName: string,
): Promise<GitSourceConnectionSettings> {
  return {
    branchName: await resolveBranchName(dependencies, options, defaultBranchName),
    defaultEnvironmentName: await resolveEnvironmentName(dependencies, options),
    autoAdoptNewApps: await resolveAutoAdoptNewAppsOption(dependencies, options),
    defaultAutoDeployEnabled: await resolveAutoDeployOption(dependencies, options),
  };
}
export async function resolveGitSourceRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  gitLabToken: string | undefined,
): Promise<GitSourceRepositorySelection> {
  if (plan.providerHost === 'github.com') {
    return await resolveGitHubRepositorySelection(dependencies, context, plan);
  }
  const gitLabState: GitLabProviderRegistrationListResponse = await listGitLabSourceRegistrations(context);
  if (
    isGitLabRepositoryProvider(
      plan.providerHost,
      gitLabToken,
      gitLabState.registrations,
      gitLabState.activeGitHubProviderHosts,
    )
  ) {
    return await resolveGitLabRepositorySelection(context, plan, gitLabToken, gitLabState.registrations);
  }
  return await resolveGitHubRepositorySelection(dependencies, context, plan);
}

async function resolveGitHubRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
): Promise<GitSourceRepositorySelection> {
  const repositoryOwner: string = await resolveGitRepositoryOwner(dependencies, plan);
  const bootstrap: GitHubProviderBootstrapResponse = await waitForGitHubSourceBootstrap(dependencies, context, {
    providerHost: plan.providerHost,
    repositoryOwner,
  });
  const canonicalRepositoryOwner: string = readCanonicalRepositoryOwner(bootstrap, repositoryOwner);
  const repository: GitHubInstallationRepositorySummary = await resolveRepositorySelection(
    dependencies,
    context,
    bootstrap.registrationId,
    bootstrap.providerHost,
    canonicalRepositoryOwner,
    plan,
  );
  return { providerHost: bootstrap.providerHost, repository };
}
export async function connectSelectedGitSource(
  context: AuthenticatedContext,
  input: ConnectSelectedGitSourceInput,
): Promise<GitSourceResponse> {
  return await connectGitSource(context, {
    autoAdoptNewApps: input.autoAdoptNewApps,
    defaultAutoDeployEnabled: input.defaultAutoDeployEnabled,
    defaultEnvironmentName: input.defaultEnvironmentName,
    providerHost: input.providerHost,
    registrationId: input.registrationId,
    repositoryName: input.repository.name,
    repositoryOwner: input.repository.owner,
    syncBranchName: input.branchName,
  });
}

async function resolveRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  registrationId: string,
  providerHost: string,
  repositoryOwner: string,
  plan: LocalGitSourcePlan,
): Promise<GitHubInstallationRepositorySummary> {
  const repositories: GitHubInstallationRepositorySummary[] = await readGitHubInstallationRepositoriesForSelection(
    dependencies,
    context,
    registrationId,
    providerHost,
    repositoryOwner,
  );
  if (repositories.length === 0) {
    throw new Error('GitHub App installation does not include any repositories.');
  }

  return await promptForRepositorySelection(
    dependencies,
    repositories,
    readDefaultGitRepositoryFullName(repositoryOwner, plan),
  );
}
async function promptForRepositorySelection(
  dependencies: CliCommandDependencies,
  repositories: GitHubInstallationRepositorySummary[],
  preferredRepositoryFullName: string,
): Promise<GitHubInstallationRepositorySummary> {
  dependencies.io.stderr(`Available repositories:\n${repositories.map(formatGitRepositoryListItem).join('\n')}\n`);
  const defaultRepositoryFullName: string = readDefaultRepositorySelection(repositories, preferredRepositoryFullName);
  for (;;) {
    const repositoryFullName: string = await promptVisibleText(
      dependencies.io,
      'Repository',
      defaultRepositoryFullName,
    );
    const repository: GitHubInstallationRepositorySummary | undefined = repositories.find(
      (candidate: GitHubInstallationRepositorySummary): boolean => candidate.fullName === repositoryFullName,
    );
    if (repository !== undefined) {
      return repository;
    }

    dependencies.io.stderr('Select one of the listed repositories by full name.\n');
  }
}
function readDefaultRepositorySelection(
  repositories: GitHubInstallationRepositorySummary[],
  preferredRepositoryFullName: string,
): string {
  const preferredRepository: GitHubInstallationRepositorySummary | undefined = repositories.find(
    (repository: GitHubInstallationRepositorySummary): boolean => repository.fullName === preferredRepositoryFullName,
  );
  return (preferredRepository ?? repositories[0]!).fullName;
}
function readCanonicalRepositoryOwner(
  bootstrap: GitHubProviderBootstrapResponse,
  requestedRepositoryOwner: string,
): string {
  return hasText(bootstrap.installationAccountLogin) ? bootstrap.installationAccountLogin : requestedRepositoryOwner;
}
async function resolveBranchName(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
  defaultBranchName: string,
): Promise<string> {
  return options.branch ?? (await promptVisibleText(dependencies.io, 'Branch', defaultBranchName));
}
async function resolveEnvironmentName(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<string> {
  return options.env ?? (await promptVisibleText(dependencies.io, 'Environment', defaultCompartmentEnvironmentName));
}
async function resolveAutoDeployOption(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<boolean> {
  if (options.autoDeploy === true) {
    return true;
  }
  if (options.manual === true) {
    return false;
  }
  return await promptForAutoDeployChoice(dependencies);
}
async function resolveAutoAdoptNewAppsOption(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<boolean> {
  if (options.all === true) {
    return true;
  }
  if (options.autoAdoptNewApps !== undefined) {
    return parseEnabledDisabledState(options.autoAdoptNewApps, '--auto-adopt-new-apps');
  }

  return await promptForAutoAdoptNewAppsChoice(dependencies);
}
export function validateConnectOptions(options: SourceConnectGitCommandOptions): void {
  if (options.autoDeploy === true && options.manual === true) {
    throw new Error('Use only one of --auto-deploy or --manual.');
  }
  if (
    options.all === true &&
    options.autoAdoptNewApps !== undefined &&
    !parseEnabledDisabledState(options.autoAdoptNewApps, '--auto-adopt-new-apps')
  ) {
    throw new Error('Use only one of --all or --auto-adopt-new-apps disabled.');
  }
}

async function promptForAutoDeployChoice(dependencies: CliCommandDependencies): Promise<boolean> {
  return await promptYesNoChoice(dependencies.io, 'Enable auto deploy? [Y/n]: ');
}

async function promptForAutoAdoptNewAppsChoice(dependencies: CliCommandDependencies): Promise<boolean> {
  return await promptYesNoChoice(dependencies.io, 'Auto-adopt new apps? [Y/n]: ');
}
