import type { Command } from 'commander';
import type { VariableResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { SetVariableInput, VariableScopeInput } from '../../services/variables.service.types';
import { setVariable } from '../../services/variables.service';
import type { CliCommandDependencies, SetVariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { resolveVariableValue } from './variable.command.input';
import { assertDeclaredResourceOutputBinding, createMutatingVariableScopeInput } from './variable.command.helpers';
import { createSetVariableMessage } from './variable.command.output';

interface SetVariableArguments {
  keyName: string;
  value?: string | undefined;
}

export function registerSetVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('set <key> [value]')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--from-resource <resource.output>')
      .option('--sensitive')
      .option('--stdin')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (keyName: string, value: string | undefined, options: SetVariableCommandOptions): Promise<void> =>
      await executeSetVariableCommand(dependencies, keyName, value, options),
  );
}

async function executeSetVariableCommand(
  dependencies: CliCommandDependencies,
  keyName: string,
  value: string | undefined,
  options: SetVariableCommandOptions,
): Promise<void> {
  const resolvedArguments: SetVariableArguments = resolveSetVariableArguments(keyName, value);
  const scopeInput: VariableScopeInput = await createMutatingVariableScopeInput(options);
  assertSetVariableSourceOptions(resolvedArguments.value, options);
  if (options.fromResource !== undefined) {
    await assertDeclaredResourceOutputBinding(scopeInput, options.fromResource, options.service!);
  }
  const request: Omit<SetVariableInput, keyof VariableScopeInput> = await buildSetVariableRequest(
    dependencies,
    resolvedArguments.keyName,
    resolvedArguments.value,
    options,
  );
  const response: VariableResponse = await setVariable(await createRemoteAuthenticatedContext(options), {
    ...request,
    ...scopeInput,
  });

  renderOutput(dependencies.io, options.output, response, createSetVariableMessage(response));
}

function resolveSetVariableArguments(keyName: string, value: string | undefined): SetVariableArguments {
  const separatorIndex: number = keyName.indexOf('=');
  if (separatorIndex === -1) {
    return { keyName, ...(value === undefined ? {} : { value }) };
  }
  if (value !== undefined) {
    throw new Error('Pass the variable value either as KEY VALUE or KEY=VALUE, not both.');
  }
  return {
    keyName: keyName.slice(0, separatorIndex),
    value: keyName.slice(separatorIndex + 1),
  };
}

async function buildSetVariableRequest(
  dependencies: CliCommandDependencies,
  keyName: string,
  value: string | undefined,
  options: SetVariableCommandOptions,
): Promise<Omit<SetVariableInput, keyof VariableScopeInput>> {
  const resolvedValue: string | undefined = await resolveSetVariableValue(dependencies, keyName, value, options);

  return {
    ...(options.fromResource !== undefined ? { fromResource: options.fromResource } : {}),
    keyName,
    ...(options.sensitive === true ? { sensitivity: 'sensitive' } : {}),
    ...(resolvedValue !== undefined ? { value: resolvedValue } : {}),
  };
}

async function resolveSetVariableValue(
  dependencies: CliCommandDependencies,
  keyName: string,
  value: string | undefined,
  options: SetVariableCommandOptions,
): Promise<string | undefined> {
  if (options.fromResource !== undefined) {
    return undefined;
  }

  return await resolveVariableValue({
    io: dependencies.io,
    keyName,
    sensitive: options.sensitive === true,
    stdin: options.stdin === true,
    value,
  });
}

function assertSetVariableSourceOptions(value: string | undefined, options: SetVariableCommandOptions): void {
  if (options.fromResource === undefined) {
    return;
  }
  if (value !== undefined || options.stdin === true || options.sensitive === true) {
    throw new Error('--from-resource cannot be combined with a literal value, --stdin, or --sensitive.');
  }
  if (options.service === undefined) {
    throw new Error('--from-resource requires --service.');
  }
}
