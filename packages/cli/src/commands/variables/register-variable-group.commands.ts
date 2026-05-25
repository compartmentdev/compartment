import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerCaptureVariableGroupCommand } from './capture-variable-group.command';
import { registerCreateVariableGroupCommand } from './create-variable-group.command';
import { registerImportVariableGroupCommand } from './import-variable-group.command';
import { registerListVariableGroupCommand } from './list-variable-group.command';
import { registerPutVariableGroupVariableCommand } from './put-variable-group-variable.command';
import { registerShowVariableGroupCommand } from './show-variable-group.command';
import { registerUsagesVariableGroupCommand } from './usages-variable-group.command';

export function registerVariableGroupCommands(program: Command, dependencies: CliCommandDependencies): void {
  const variableGroupCommand: Command = program.command('group').description('Variable group commands');

  registerCaptureVariableGroupCommand(variableGroupCommand, dependencies);
  registerCreateVariableGroupCommand(variableGroupCommand, dependencies);
  registerImportVariableGroupCommand(variableGroupCommand, dependencies);
  registerListVariableGroupCommand(variableGroupCommand, dependencies);
  registerPutVariableGroupVariableCommand(variableGroupCommand, dependencies);
  registerShowVariableGroupCommand(variableGroupCommand, dependencies);
  registerUsagesVariableGroupCommand(variableGroupCommand, dependencies);
}
