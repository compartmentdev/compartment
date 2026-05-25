import type { Command } from 'commander';
import type { ImportVariableGroupResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { readVariableImportEntries } from '../../services/variable-import-file.service';
import { importVariableGroup } from '../../services/variable-groups.service';
import type { CliCommandDependencies, VariableGroupImportCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createImportVariableGroupMessage } from './variable-group.command.output';

export function registerImportVariableGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('import <group>')
      .requiredOption('--file <path>')
      .option('--replace')
      .option('--sensitive')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (variableGroupName: string, options: VariableGroupImportCommandOptions): Promise<void> => {
    const response: ImportVariableGroupResponse = await importVariableGroup(
      await createRemoteAuthenticatedContext(options),
      {
        entries: await readVariableImportEntries(options.file),
        replace: options.replace,
        ...(options.sensitive === true ? { sensitivity: 'sensitive' as const } : {}),
        variableGroupName,
      },
    );
    renderOutput(dependencies.io, options.output, response, createImportVariableGroupMessage(response));
  });
}
