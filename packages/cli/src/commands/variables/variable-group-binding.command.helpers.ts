import type { Command } from 'commander';
import type { VariableGroupBindingResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { AuthenticatedContext } from '../../services/context.types';
import type { VariableGroupBindingInput } from '../../services/variable-groups.service.types';
import type { CliCommandDependencies, VariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createVariableGroupBindingInput } from './variable.command.helpers';

type VariableGroupBindingExecutor = (
  context: AuthenticatedContext,
  input: VariableGroupBindingInput,
) => Promise<VariableGroupBindingResponse>;
type VariableGroupBindingMessageCreator = (response: VariableGroupBindingResponse) => string;

interface RegisterVariableGroupBindingCommandInput {
  commandName: 'bind' | 'unbind';
  createMessage: VariableGroupBindingMessageCreator;
  execute: VariableGroupBindingExecutor;
  requireDeclaredResourceTarget: boolean;
}

export function registerVariableGroupBindingCommand(
  program: Command,
  dependencies: CliCommandDependencies,
  input: RegisterVariableGroupBindingCommandInput,
): void {
  addRemoteOption(
    program
      .command(`${input.commandName} <name>`)
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (variableGroupName: string, options: VariableCommandOptions): Promise<void> =>
      await executeVariableGroupBindingCommand(dependencies, input, variableGroupName, options),
  );
}

async function executeVariableGroupBindingCommand(
  dependencies: CliCommandDependencies,
  input: RegisterVariableGroupBindingCommandInput,
  variableGroupName: string,
  options: VariableCommandOptions,
): Promise<void> {
  const bindingInput: VariableGroupBindingInput = await createVariableGroupBindingInput(
    options,
    variableGroupName,
    input.requireDeclaredResourceTarget,
  );
  const response: VariableGroupBindingResponse = await input.execute(
    await createRemoteAuthenticatedContext(options),
    bindingInput,
  );
  renderOutput(dependencies.io, options.output, response, input.createMessage(response));
}
