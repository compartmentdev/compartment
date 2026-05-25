import type { Command } from 'commander';
import type { DisconnectGitSourceResponse } from '@compartment/contracts';
import { disconnectSource } from '../../services/sources.service';
import { renderOutput } from '../../output/render';
import type { CliCommandDependencies, SourceDisconnectCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createGitSourceDisconnectMessage } from './source.command.helpers';

export function registerSourceDisconnectCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('disconnect <sourceId>')
      .option('--output <format>', 'text or json', 'text')
      .option('--yes', 'confirm source disconnect'),
  ).action(async (sourceId: string, options: SourceDisconnectCommandOptions): Promise<void> => {
    if (options.yes !== true) {
      throw new Error('Use --yes to confirm source disconnect.');
    }

    const response: DisconnectGitSourceResponse = await disconnectSource(
      await createRemoteAuthenticatedContext(options),
      sourceId,
    );
    renderOutput(dependencies.io, options.output, response, createGitSourceDisconnectMessage(sourceId));
  });
}
