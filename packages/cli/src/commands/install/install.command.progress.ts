import { createCommandProgress } from '../command.progress';
import type { CliIo } from '../../app.types';
import type { InstallCommandProgress, InstallCommandProgressInput } from './install.command.progress.types';
import type { InstallCommandOptions } from './install.command.types';

export function createInstallCommandProgress(input: InstallCommandProgressInput): InstallCommandProgress {
  return createCommandProgress({
    io: input.io,
    output: readInstallCommandProgressOutput(input.options),
  });
}

export function renderPersistentInstallProgress(
  io: CliIo,
  options: InstallCommandOptions,
  progress: InstallCommandProgress,
  message: string,
): void {
  progress.stop();
  if (readInstallCommandProgressOutput(options) !== 'text') {
    return;
  }

  io.stderr(`${message}\n`);
}

function readInstallCommandProgressOutput(options: InstallCommandOptions): 'json' | 'text' {
  return options.internalInstallResult === true ? 'text' : options.output;
}
