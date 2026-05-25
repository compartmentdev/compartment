import { renderOutput } from '../../output/render';
import type { SelfHostedInstallResult } from '../../install.types';
import type { CliCommandDependencies } from '../command.types';
import { shouldUseTerminalStyles } from '../terminal-style.helpers';
import { createSelfHostedInstallResultMessage, toInstallResponse } from './install.command.helpers';
import { persistInstallSession } from './install.command.session';
import type { InstallCommandOptions } from './install.command.types';

export async function persistSelfHostedInstallSessionIfNeeded(
  options: InstallCommandOptions,
  result: SelfHostedInstallResult,
): Promise<boolean> {
  if (options.skipSessionPersist === true) {
    return false;
  }

  await persistInstallSession(result);
  return true;
}

export function renderSelfHostedInstallResult(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  result: SelfHostedInstallResult,
  sessionPersisted: boolean,
): void {
  if (options.internalInstallResult === true) {
    renderOutput(dependencies.io, 'json', result, '');
    return;
  }

  renderOutput(
    dependencies.io,
    options.output,
    toInstallResponse(result),
    createSelfHostedInstallResultMessage(result, sessionPersisted, shouldUseTerminalStyles(dependencies.io, 'stdout')),
  );
}
