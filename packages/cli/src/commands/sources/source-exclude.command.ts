import type { GitSourceExclusionMutationResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import type { AuthenticatedContext } from '../../services/context.types';
import { excludeSourceDescriptor } from '../../services/sources.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createGitSourceExcludeMessage } from './source.command.helpers';

export function registerSourceExcludeCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program.command('exclude <sourceId> <descriptorPath>').option('--output <format>', 'text or json', 'text'),
  ).action(async (sourceId: string, descriptorPath: string, options: OutputOnlyOptions): Promise<void> => {
    const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
    const response: GitSourceExclusionMutationResponse = await excludeSourceDescriptor(
      context,
      sourceId,
      descriptorPath,
    );
    renderOutput(dependencies.io, options.output, response, createGitSourceExcludeMessage(response));
  });
}
