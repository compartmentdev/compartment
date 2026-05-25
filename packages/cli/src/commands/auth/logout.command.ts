import type { Command } from 'commander';
import type { LogoutResponse } from '@compartment/contracts';

import { renderOutput } from '../../output/render';
import { logout } from '../../services/logout.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { listConfiguredRemoteNames, resolveRemoteContext } from '../../services/remote-context.service';
import { buildLoggedOutConfig } from '../../store/config.mutations';
import { clearCliConfig, readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext, hasAuthenticatedSession, toAuthenticatedContextError } from '../command-context';
import { RemoteContextResolutionError, type RemoteContextInput } from '../../services/remote-context.types';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

export function registerLogoutCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('logout').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => await executeLogoutCommand(dependencies, options),
  );
}

async function executeLogoutCommand(dependencies: CliCommandDependencies, options: OutputOnlyOptions): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  await clearResolvedLoginState(config, options);

  const response: LogoutResponse = {
    success: true,
  };
  renderOutput(dependencies.io, options.output, response, 'Logged out.');
}

async function clearResolvedLoginState(config: CliConfig, options: OutputOnlyOptions): Promise<void> {
  const resolvedRemoteName: string | undefined = await resolveLogoutRemoteName(config, options.remote);
  if (resolvedRemoteName === undefined) {
    if (listConfiguredRemoteNames(config).length > 0) {
      throw toAuthenticatedContextError(
        config,
        new RemoteContextResolutionError({ code: 'remote_selection_required' }),
      );
    }
    await clearCliConfig();
    return;
  }

  const logoutInput: RemoteContextInput = { cwd: process.cwd(), remoteName: resolvedRemoteName };

  if (await hasAuthenticatedSession(config, logoutInput)) {
    const context: AuthenticatedContext = await createAuthenticatedContext(config, logoutInput);
    await logoutAndClearConfig(config, context);
    return;
  }

  await writeCliConfig(buildLoggedOutConfig(config, resolvedRemoteName));
}

async function resolveLogoutRemoteName(
  config: CliConfig,
  explicitRemoteName: string | undefined,
): Promise<string | undefined> {
  try {
    return (await resolveRemoteContext(config, { cwd: process.cwd(), remoteName: explicitRemoteName })).remoteName;
  } catch (error) {
    if (error instanceof RemoteContextResolutionError && error.code === 'remote_selection_required') {
      return undefined;
    }

    throw toAuthenticatedContextError(
      config,
      error instanceof Error ? error : new Error('Unknown authenticated context error.'),
    );
  }
}

async function logoutAndClearConfig(config: CliConfig, context: AuthenticatedContext): Promise<void> {
  let logoutError: Error | undefined;

  try {
    await logout(context);
  } catch (error) {
    logoutError = error instanceof Error ? error : new Error('Failed to log out.');
  }

  await writeLoggedOutConfig(config, context.remoteName);

  if (logoutError !== undefined) {
    throw logoutError;
  }
}

async function writeLoggedOutConfig(config: CliConfig, remoteName: string): Promise<void> {
  await writeCliConfig(buildLoggedOutConfig(config, remoteName));
}
