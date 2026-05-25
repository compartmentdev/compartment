import type { Command } from 'commander';
import type { GitSourceResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { showSource } from '../../services/sources.service';
import type { CliCommandDependencies, SourceShowCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createGitSourceShowMessage } from './source.command.helpers';

export function registerSourceShowCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('show <sourceId>').option('--output <format>', 'text or json', 'text')).action(
    async (sourceId: string, options: SourceShowCommandOptions): Promise<void> => {
      const response: GitSourceResponse = await showSource(await createRemoteAuthenticatedContext(options), sourceId);
      renderOutput(dependencies.io, options.output, response, createGitSourceShowMessage(response));
    },
  );
}
