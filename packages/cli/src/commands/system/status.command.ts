import { systemStatusResponseSchema, type SystemStatusResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { getSelfHostedSystemStatus } from '../../system-status';
import type { CliCommandDependencies, CliIoCommandDependencies } from '../command.types';
import { createSelfHostedCommandContext } from '../self-hosted.command.context';
import { createSelfHostedProgressReporter } from '../self-hosted.command.progress';
import { createSystemStatusResultMessage } from './system.command.helpers';
import { executeSelfHostedSystemCommandWithSudoFallback } from './system.command.sudo';
import type { SystemStatusCommandOptions } from './system.command.types';

export function registerStatusSystemCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('status')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: SystemStatusCommandOptions): Promise<void> => await executeStatusCommand(dependencies, options),
    );
}

async function executeStatusCommand(
  dependencies: CliCommandDependencies,
  options: SystemStatusCommandOptions,
): Promise<void> {
  await executeSelfHostedSystemCommandWithSudoFallback(
    dependencies,
    async (): Promise<void> => await executeStatusCommandLocally(dependencies, options),
  );
}

async function executeStatusCommandLocally(
  dependencies: CliIoCommandDependencies,
  options: SystemStatusCommandOptions,
): Promise<void> {
  const result: SystemStatusResponse = systemStatusResponseSchema.parse(
    await getSelfHostedSystemStatus({
      context: createSelfHostedCommandContext(dependencies, createSelfHostedProgressReporter(dependencies)),
    }),
  );

  renderOutput(dependencies.io, options.output, result, createSystemStatusResultMessage(result));
}
