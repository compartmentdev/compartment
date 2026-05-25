import type { Command } from 'commander';
import type { ImportVariablesResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { ImportVariablesInput, VariableScopeInput } from '../../services/variables.service.types';
import { readVariableImportEntries } from '../../services/variable-import-file.service';
import { importVariables } from '../../services/variables.service';
import type { CliCommandDependencies, ImportVariableCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createMutatingVariableScopeInput } from './variable.command.helpers';
import { createImportVariablesMessage } from './variable.command.output';

export function registerImportVariableCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('import')
      .requiredOption('--file <path>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--resource <name>')
      .option('--replace')
      .option('--sensitive')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ImportVariableCommandOptions): Promise<void> => {
    await executeImportVariableCommand(dependencies, options);
  });
}

async function executeImportVariableCommand(
  dependencies: CliCommandDependencies,
  options: ImportVariableCommandOptions,
): Promise<void> {
  const response: ImportVariablesResponse = await importVariables(
    await createRemoteAuthenticatedContext(options),
    await createImportVariablesInput(options),
  );

  renderOutput(dependencies.io, options.output, response, createImportVariablesMessage(response));
}

async function createImportVariablesInput(options: ImportVariableCommandOptions): Promise<ImportVariablesInput> {
  const scopeInput: VariableScopeInput = await createMutatingVariableScopeInput(options);

  return {
    ...scopeInput,
    entries: await readVariableImportEntries(options.file),
    replace: options.replace,
    ...(options.sensitive === true ? { sensitivity: 'sensitive' } : {}),
  };
}
