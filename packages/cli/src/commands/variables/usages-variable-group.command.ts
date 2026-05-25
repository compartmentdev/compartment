import type { Command } from 'commander';
import type { VariableGroupUsagesResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listVariableGroupUsages } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableGroupUsagesMessage } from './variable-group.command.output';

export function registerUsagesVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('usages <name>').option('--output <format>', 'text or json', 'text')).action(
    async (variableGroupName: string, options: VariableGroupCommandOptions): Promise<void> => {
      const response: VariableGroupUsagesResponse = await listVariableGroupUsages(
        await createRemoteAuthenticatedContext(options),
        { variableGroupName },
      );
      renderOutput(dependencies.io, options.output, response, createVariableGroupUsagesMessage(response));
    },
  );
}
