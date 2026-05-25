import type { GitHubProviderBootstrapResponse } from '@compartment/contracts';
import { getGitHubSourceBootstrapStatus, startGitHubSourceBootstrap } from '../../services/sources.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies } from '../command.types';
import { formatTerminalBold, shouldUseTerminalStyles } from '../terminal-style.helpers';
import { pollSourceCommandValue } from './source.command.helpers';

interface GitHubSourceBootstrapSelection {
  providerHost: string;
  repositoryOwner: string;
}

export async function waitForGitHubSourceBootstrap(
  dependencies: CliCommandDependencies,
  context: AuthenticatedContext,
  selection: GitHubSourceBootstrapSelection,
): Promise<GitHubProviderBootstrapResponse> {
  const bootstrap: GitHubProviderBootstrapResponse = await startGitHubSourceBootstrap(
    context,
    selection.providerHost,
    selection.repositoryOwner,
  );
  if (bootstrap.status === 'active') {
    return bootstrap;
  }

  const bootstrapStateId: string = readBootstrapStateId(bootstrap);
  const heading: string = formatTerminalBold(
    'Open this URL in a browser to continue GitHub App setup:',
    shouldUseTerminalStyles(dependencies.io, 'stderr'),
  );
  dependencies.io.stderr(`${heading}\n${bootstrap.browserUrl}\n`);
  return await pollBootstrapStatus(context, bootstrapStateId);
}

function readBootstrapStateId(bootstrap: GitHubProviderBootstrapResponse): string {
  if (bootstrap.browserUrl === null || bootstrap.bootstrapStateId === null) {
    throw new Error('GitHub App bootstrap did not return a browser URL.');
  }

  return bootstrap.bootstrapStateId;
}

async function pollBootstrapStatus(
  context: AuthenticatedContext,
  bootstrapStateId: string,
): Promise<GitHubProviderBootstrapResponse> {
  return await pollSourceCommandValue<GitHubProviderBootstrapResponse>({
    isTerminal: (bootstrap: GitHubProviderBootstrapResponse): boolean => bootstrap.status === 'active',
    readValue: async (): Promise<GitHubProviderBootstrapResponse> => {
      const bootstrap: GitHubProviderBootstrapResponse = await getGitHubSourceBootstrapStatus(
        context,
        bootstrapStateId,
      );
      if (bootstrap.status === 'failed') {
        throw new Error('GitHub App bootstrap failed. Restart `compartment source connect git`.');
      }

      return bootstrap;
    },
    timeoutMessage: 'Timed out waiting for GitHub App bootstrap to complete.',
  });
}
