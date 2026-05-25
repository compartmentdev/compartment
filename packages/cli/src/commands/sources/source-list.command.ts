import type { Command } from 'commander';
import type { GitSourceListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listSources } from '../../services/sources.service';
import type { CliCommandDependencies, SourceListCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createGitSourceListMessage } from './source.command.helpers';

export function registerSourceListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: SourceListCommandOptions): Promise<void> => {
      const response: GitSourceListResponse = await listSources(await createRemoteAuthenticatedContext(options));
      renderOutput(dependencies.io, options.output, response, createGitSourceListMessage(response));
    },
  );
}
