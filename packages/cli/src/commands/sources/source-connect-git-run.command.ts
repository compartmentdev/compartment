import type { GitSourceResponse } from '@compartment/contracts';
import { readLocalGitSourcePlan } from '../../services/source-git-local.service';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, SourceConnectGitCommandOptions } from '../command.types';
import { createRemoteAuthenticatedContext } from '../remote.command.helpers';
import {
  connectSelectedGitSource,
  resolveGitSourceConnectionSettings,
  resolveGitSourceRepositorySelection,
  validateConnectOptions,
  type GitSourceConnectionSettings,
  type GitSourceRepositorySelection,
} from './source-connect-git.command';
import { createGitSourceConnectMessage } from './source.command.helpers';

export async function runSourceConnectGitCommand(
  dependencies: CliCommandDependencies,
  options: SourceConnectGitCommandOptions,
): Promise<void> {
  const context: AuthenticatedContext = await createValidatedContext(options);
  const plan: LocalGitSourcePlan = await readLocalGitSourcePlan(process.cwd());
  const selection: GitSourceRepositorySelection = await resolveGitSourceRepositorySelection(
    dependencies,
    context,
    plan,
    process.env.COMPARTMENT_GITLAB_TOKEN,
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

async function createValidatedContext(options: SourceConnectGitCommandOptions): Promise<AuthenticatedContext> {
  validateConnectOptions(options);
  return await createRemoteAuthenticatedContext(options);
}
