import type { Command } from 'commander';
import type { VariableListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listVariables } from '../../services/variables.service';
import type { CliCommandDependencies, VariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableScopeInput } from './variable.command.helpers';
import { createVariableListMessage } from './variable.command.output';

export function registerListVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('list')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: VariableCommandOptions): Promise<void> => await executeListVariableCommand(dependencies, options),
  );
}

async function executeListVariableCommand(
  dependencies: CliCommandDependencies,
  options: VariableCommandOptions,
): Promise<void> {
  const response: VariableListResponse = await listVariables(
    await createRemoteAuthenticatedContext(options),
    createVariableScopeInput(options),
  );

  renderOutput(dependencies.io, options.output, response, createVariableListMessage(response));
}
