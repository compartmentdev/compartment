import { systemRestartResponseSchema, type SystemRestartResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { restartSelfHostedSystem } from '../../system-restart';
import type { CliCommandDependencies, CliIoCommandDependencies } from '../command.types';
import { createCommandProgress } from '../command.progress';
import type { CommandProgress } from '../command.progress.types';
import { createSelfHostedCommandContext } from '../self-hosted.command.context';
import type { InstallProgressReportOptions } from '../../install.types';
import { createSystemRestartResultMessage } from './system.command.helpers';
import { executeSelfHostedSystemCommandWithSudoFallback } from './system.command.sudo';
import type { SystemRestartCommandOptions } from './system.command.types';

export function registerRestartSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('restart')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemRestartCommandOptions): Promise<void> => await executeRestartCommand(dependencies, options),
    );
}

async function executeRestartCommand(
  dependencies: CliCommandDependencies,
  options: SystemRestartCommandOptions,
): Promise<void> {
  await executeSelfHostedSystemCommandWithSudoFallback(
    dependencies,
    async (): Promise<void> => await executeRestartCommandLocally(dependencies, options),
  );
}

async function executeRestartCommandLocally(
  dependencies: CliIoCommandDependencies,
  options: SystemRestartCommandOptions,
): Promise<void> {
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });

  try {
    const result: SystemRestartResponse = systemRestartResponseSchema.parse(
      await restartSelfHostedSystem({
        context: createSelfHostedCommandContext(
          dependencies,
          (message: string, progressOptions?: InstallProgressReportOptions): void =>
            progress.report(message, progressOptions),
        ),
      }),
    );

    progress.stop();
    renderOutput(dependencies.io, options.output, result, createSystemRestartResultMessage(result));
  } finally {
    progress.stop();
  }
}
