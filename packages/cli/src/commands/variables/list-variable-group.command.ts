import type { Command } from 'commander';
import type { VariableGroupListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listVariableGroups } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableGroupListMessage } from './variable-group.command.output';

export function registerListVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: VariableGroupCommandOptions): Promise<void> => {
      const response: VariableGroupListResponse = await listVariableGroups(
        await createRemoteAuthenticatedContext(options),
      );
      renderOutput(dependencies.io, options.output, response, createVariableGroupListMessage(response));
    },
  );
}
