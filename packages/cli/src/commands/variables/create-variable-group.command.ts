import type { Command } from 'commander';
import type { VariableGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createVariableGroup } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createCreateVariableGroupMessage } from './variable-group.command.output';

export function registerCreateVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('create <name>').option('--output <format>', 'text or json', 'text')).action(
    async (variableGroupName: string, options: VariableGroupCommandOptions): Promise<void> => {
      const response: VariableGroupResponse = await createVariableGroup(
        await createRemoteAuthenticatedContext(options),
        { variableGroupName },
      );
      renderOutput(dependencies.io, options.output, response, createCreateVariableGroupMessage(response));
    },
  );
}
