import type { CliRemoteListResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { listRemotes, createRemoteListMessage } from '../../services/remotes.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';

export function registerListRemotesCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('list')
    .option('--output <format>', 'text or json', 'text')
    .action(async (options: OutputOnlyOptions): Promise<void> => {
      const config: CliConfig = await readCliConfig();
      const response: CliRemoteListResponse = listRemotes(config);

      renderOutput(dependencies.io, options.output, response, createRemoteListMessage(response));
    });
}
