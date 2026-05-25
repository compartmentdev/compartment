import type { Command } from 'commander';
import type { AuthenticatedContext } from '../services/context.types';
import { assertValidRemoteName } from '../services/remote-name.service';
import type { ProjectStateScope } from '../services/project-state-scope.service.types';
import { readCliConfig } from '../store/config.store';
import { createAuthenticatedContext } from './command-context';

interface RemoteOptionInput {
  remote?: string | undefined;
}

interface AuthenticatedContextInputOverrides {
  cwd?: string | undefined;
  projectStateScope?: ProjectStateScope | undefined;
}

export function addRemoteOption(command: Command): Command {
  return command.option('--remote <name>');
}

export async function createRemoteAuthenticatedContext(options: RemoteOptionInput): Promise<AuthenticatedContext> {
  assertValidRemoteOption(options);
  return await createAuthenticatedContext(await readCliConfig(), {
    cwd: process.cwd(),
    remoteName: options.remote,
  });
}

export async function createRemoteAuthenticatedContextWithOverrides(
  options: RemoteOptionInput,
  overrides: AuthenticatedContextInputOverrides = {},
): Promise<AuthenticatedContext> {
  assertValidRemoteOption(options);
  const cwd: string = overrides.cwd ?? process.cwd();
  return await createAuthenticatedContext(await readCliConfig(), {
    cwd,
    ...(overrides.projectStateScope !== undefined ? { projectStateScope: overrides.projectStateScope } : {}),
    remoteName: options.remote,
  });
}

export function assertValidRemoteOption(options: RemoteOptionInput): void {
  if (options.remote !== undefined) {
    assertValidRemoteName(options.remote);
  }
}
