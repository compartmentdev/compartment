import {
  defaultCompartmentEnvironmentName,
  type GitProviderRepositorySummary,
  type GitHubProviderBootstrapResponse,
  type GitSourceResponse,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { Command } from 'commander';
import { promptVisibleText } from '../../prompts/prompt';
import { connectGitSource } from '../../services/sources.service';
import { readLocalGitSourcePlan } from '../../services/source-git-local.service';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, SourceConnectGitCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { waitForGitHubSourceBootstrap } from './source-connect-git-bootstrap.command';
import { readGitHubInstallationRepositoriesForSelection } from './source-connect-git-repository-list';
import { createGitSourceConnectMessage, parseEnabledDisabledState, promptYesNoChoice } from './source.command.helpers';

interface GitSourceRepositorySelection {
  providerHost: string;
  registrationId: string;
  repository: GitProviderRepositorySummary;
}

interface ConnectSelectedGitSourceInput {
  autoAdoptNewApps: boolean;
  branchName: string;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
  providerHost: string;
  registrationId: string;
  repository: GitProviderRepositorySummary;
}

interface GitSourceConnectionSettings {
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

async function runSourceConnectGitCommand(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<void> {
  validateConnectOptions(options);
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
  const plan: LocalGitSourcePlan = await readLocalGitSourcePlan(process.cwd());
  const selection: GitSourceRepositorySelection = await resolveGitSourceRepositorySelection(
    dependencies,
    context,
    plan,
  );
  const settings: GitSourceConnectionSettings = await resolveGitSourceConnectionSettings(
    dependencies,
    options,
    selection.repository.defaultBranchName,
  );
  const response: GitSourceResponse = await connectSelectedGitSource(context, {
    ...settings,
    providerHost: selection.providerHost,
    registrationId: selection.registrationId,
    repository: selection.repository,
  });
  dependencies.io.stdout(`${createGitSourceConnectMessage(response)}\n`);
}

async function resolveGitSourceConnectionSettings(
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

async function resolveGitSourceRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
): Promise<GitSourceRepositorySelection> {
  const repositoryOwner: string = await resolveRepositoryOwner(dependencies, plan);
  const bootstrap: GitHubProviderBootstrapResponse = await waitForGitHubSourceBootstrap(dependencies, context, {
    providerHost: plan.providerHost,
    repositoryOwner,
  });
  const canonicalRepositoryOwner: string = readCanonicalRepositoryOwner(bootstrap, repositoryOwner);
  const repository: GitProviderRepositorySummary = await resolveRepositorySelection(
    dependencies,
    context,
    bootstrap.registrationId,
    canonicalRepositoryOwner,
    plan,
  );
  return { providerHost: bootstrap.providerHost, registrationId: bootstrap.registrationId, repository };
}

async function connectSelectedGitSource(
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

async function resolveRepositoryOwner(dependencies: CliCommandDependencies, plan: LocalGitSourcePlan): Promise<string> {
  return await promptVisibleText(dependencies.io, 'GitHub account or organization', plan.repositoryOwner);
}

async function resolveRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  registrationId: string,
  repositoryOwner: string,
  plan: LocalGitSourcePlan,
): Promise<GitProviderRepositorySummary> {
  const repositories: GitProviderRepositorySummary[] = await readGitHubInstallationRepositoriesForSelection(
    context,
    registrationId,
  );
  if (repositories.length === 0) {
    throw new Error('GitHub App installation does not include any repositories.');
  }

  return await promptForRepositorySelection(
    dependencies,
    repositories,
    readDefaultRepositoryFullName(repositoryOwner, plan),
  );
}

async function promptForRepositorySelection(
  dependencies: CliCommandDependencies,
  repositories: GitProviderRepositorySummary[],
  preferredRepositoryFullName: string,
): Promise<GitProviderRepositorySummary> {
  dependencies.io.stderr(`Available repositories:\n${repositories.map(formatRepositoryListItem).join('\n')}\n`);
  const defaultRepositoryFullName: string = readDefaultRepositorySelection(repositories, preferredRepositoryFullName);
  for (;;) {
    const repositoryFullName: string = await promptVisibleText(
      dependencies.io,
      'Repository',
      defaultRepositoryFullName,
    );
    const repository: GitProviderRepositorySummary | undefined = repositories.find(
      (candidate: GitProviderRepositorySummary): boolean => candidate.fullName === repositoryFullName,
    );
    if (repository !== undefined) {
      return repository;
    }

    dependencies.io.stderr('Select one of the listed repositories by full name.\n');
  }
}

function formatRepositoryListItem(repository: GitProviderRepositorySummary): string {
  return `- ${repository.fullName}\tdefault branch: ${repository.defaultBranchName}`;
}

function readDefaultRepositorySelection(
  repositories: GitProviderRepositorySummary[],
  preferredRepositoryFullName: string,
): string {
  const preferredRepository: GitProviderRepositorySummary | undefined = repositories.find(
    (repository: GitProviderRepositorySummary): boolean => repository.fullName === preferredRepositoryFullName,
  );
  return (preferredRepository ?? repositories[0]!).fullName;
}

function readDefaultRepositoryFullName(repositoryOwner: string, plan: LocalGitSourcePlan): string {
  return `${repositoryOwner}/${plan.repositoryName}`;
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

function validateConnectOptions(options: SourceConnectGitCommandOptions): void {
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
