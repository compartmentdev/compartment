import {
  defaultCompartmentEnvironmentName,
  type GitProviderRegistrationSummary,
  type GitProviderRepositorySummary,
  type GitSourceResponse,
} from '@compartment/contracts';
import { promptVisibleText } from '../../prompts/prompt';
import { connectGitSource, listGitSourceRegistrations } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import type { CliCommandDependencies, SourceConnectGitCommandOptions } from '../command.types';
import type { GitSourceProviderDescriptor, GitSourceRepositorySelection } from './source-connect-git-provider.types';
import { resolveGitSourceProvider } from './source-connect-git-providers';
import { parseEnabledDisabledState, promptYesNoChoice } from './source.command.helpers';

interface ConnectSelectedGitSourceInput extends GitSourceConnectionSettings {
  providerHost: string;
  registrationId: string;
  repository: GitProviderRepositorySummary;
}

export interface GitSourceConnectionSettings {
  autoAdoptNewApps: boolean;
  branchName: string;
  defaultAutoDeployEnabled: boolean;
  defaultEnvironmentName: string;
}

export async function resolveGitSourceRepositorySelection(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  plan: LocalGitSourcePlan,
  explicitProvider: string | undefined,
): Promise<GitSourceRepositorySelection> {
  const registrations: GitProviderRegistrationSummary[] = (await listGitSourceRegistrations(context)).registrations;
  const descriptor: GitSourceProviderDescriptor = resolveGitSourceProvider(
    plan.providerHost,
    explicitProvider,
    registrations,
  );
  return await descriptor.selectRepository({ context, dependencies, plan, registrations });
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

export async function resolveGitSourceConnectionSettings(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
  defaultBranchName: string,
): Promise<GitSourceConnectionSettings> {
  return {
    branchName: options.branch ?? (await promptVisibleText(dependencies.io, 'Branch', defaultBranchName)),
    defaultEnvironmentName:
      options.env ?? (await promptVisibleText(dependencies.io, 'Environment', defaultCompartmentEnvironmentName)),
    autoAdoptNewApps: await resolveAutoAdoptNewAppsOption(dependencies, options),
    defaultAutoDeployEnabled: await resolveAutoDeployOption(dependencies, options),
  };
}

export function validateConnectOptions(options: SourceConnectGitCommandOptions): void {
  if (options.autoDeploy === true && options.manual === true)
    throw new Error('Use only one of --auto-deploy or --manual.');
  if (
    options.all === true &&
    options.autoAdoptNewApps !== undefined &&
    !parseEnabledDisabledState(options.autoAdoptNewApps, '--auto-adopt-new-apps')
  ) {
    throw new Error('Use only one of --all or --auto-adopt-new-apps disabled.');
  }
}

async function resolveAutoDeployOption(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<boolean> {
  if (options.autoDeploy === true) return true;
  if (options.manual === true) return false;
  return await promptYesNoChoice(dependencies.io, 'Enable auto deploy? [Y/n]: ');
}

async function resolveAutoAdoptNewAppsOption(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<boolean> {
  if (options.all === true) return true;
  if (options.autoAdoptNewApps !== undefined) {
    return parseEnabledDisabledState(options.autoAdoptNewApps, '--auto-adopt-new-apps');
  }
  return await promptYesNoChoice(dependencies.io, 'Auto-adopt new apps? [Y/n]: ');
}
