import type { Command } from 'commander';
import type { RemoveVariableResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { VariableScopeInput } from '../../services/variables.service.types';
import { removeVariable } from '../../services/variables.service';
import type { CliCommandDependencies, VariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableScopeInput } from './variable.command.helpers';
import { createRemoveVariableMessage } from './variable.command.output';

export function registerRemoveVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('remove <key>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (keyName: string, options: VariableCommandOptions): Promise<void> =>
      await executeRemoveVariableCommand(dependencies, keyName, options),
  );
}

async function executeRemoveVariableCommand(
  dependencies: CliCommandDependencies,
  keyName: string,
  options: VariableCommandOptions,
): Promise<void> {
  const scopeInput: VariableScopeInput = createVariableScopeInput(options);
  const response: RemoveVariableResponse = await removeVariable(await createRemoteAuthenticatedContext(options), {
    ...scopeInput,
    keyName,
  });

  renderOutput(dependencies.io, options.output, response, createRemoveVariableMessage(keyName));
}
