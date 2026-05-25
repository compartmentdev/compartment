import { createCommandProgress } from '../command.progress';
import type { CliIo } from '../../app.types';
import type { InstallCommandProgress, InstallCommandProgressInput } from './install.command.progress.types';
import type { InstallCommandOptions } from './install.command.types';

export function createInstallCommandProgress(input: InstallCommandProgressInput): InstallCommandProgress {
  return createCommandProgress({
    enabled: input.options.internalInstallResult !== true,
    io: input.io,
    output: input.options.output,
  });
}

export function renderPersistentInstallProgress(
  io: CliIo,
  options: InstallCommandOptions,
  progress: InstallCommandProgress,
  message: string,
): void {
  progress.stop();
  if (options.internalInstallResult === true || options.output !== 'text') {
    return;
  }

  io.stderr(`${message}\n`);
}
