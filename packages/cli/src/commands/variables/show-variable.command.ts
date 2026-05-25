import type { Command } from 'commander';
import type { VariableResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { showVariable } from '../../services/variables.service';
import type { CliCommandDependencies, VariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableScopeInput } from './variable.command.helpers';
import { createVariableShowMessage } from './variable.command.output';

export function registerShowVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('show <key>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (keyName: string, options: VariableCommandOptions): Promise<void> =>
      await executeShowVariableCommand(dependencies, keyName, options),
  );
}

async function executeShowVariableCommand(
  dependencies: CliCommandDependencies,
  keyName: string,
  options: VariableCommandOptions,
): Promise<void> {
  const response: VariableResponse = await showVariable(await createRemoteAuthenticatedContext(options), {
    ...createVariableScopeInput(options),
    keyName,
  });

  renderOutput(dependencies.io, options.output, response, createVariableShowMessage(response));
}
