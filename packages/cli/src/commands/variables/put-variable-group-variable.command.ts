import type { Command } from 'commander';
import type { VariableGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { putVariableGroupVariable } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupPutCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { resolveVariableValue } from './variable.command.input';
import { createPutVariableGroupVariableMessage } from './variable-group.command.output';

export function registerPutVariableGroupVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('put <group> <key> [value]')
      .option('--sensitive')
      .option('--stdin')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (
      variableGroupName: string,
      keyName: string,
      value: string | undefined,
      options: VariableGroupPutCommandOptions,
    ): Promise<void> =>
      await executePutVariableGroupVariableCommand(dependencies, variableGroupName, keyName, value, options),
  );
}

async function executePutVariableGroupVariableCommand(
  dependencies: CliCommandDependencies,
  variableGroupName: string,
  keyName: string,
  value: string | undefined,
  options: VariableGroupPutCommandOptions,
): Promise<void> {
  const resolvedValue: string = await resolveVariableValue({
    io: dependencies.io,
    keyName,
    sensitive: options.sensitive === true,
    stdin: options.stdin === true,
    value,
  });
  const response: VariableGroupResponse = await putVariableGroupVariable(
    await createRemoteAuthenticatedContext(options),
    createPutVariableGroupVariableInput(variableGroupName, keyName, resolvedValue, options),
  );

  renderOutput(dependencies.io, options.output, response, createPutVariableGroupVariableMessage(response));
}

function createPutVariableGroupVariableInput(
  variableGroupName: string,
  keyName: string,
  value: string,
  options: VariableGroupPutCommandOptions,
): {
  keyName: string;
  sensitivity?: 'sensitive' | undefined;
  value: string;
  variableGroupName: string;
} {
  return {
    keyName,
    ...(options.sensitive === true ? { sensitivity: 'sensitive' as const } : {}),
    value,
    variableGroupName,
  };
}
