import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerBindVariableGroupCommand } from './bind-variable-group.command';
import { registerImportVariableCommand } from './import-variable.command';
import { registerListVariableCommand } from './list-variable.command';
import { registerVariableGroupCommands } from './register-variable-group.commands';
import { registerRemoveVariableCommand } from './remove-variable.command';
import { registerRunVariableCommand } from './run-variable.command';
import { registerSetVariableCommand } from './set-variable.command';
import { registerShowVariableCommand } from './show-variable.command';
import { registerUnbindVariableGroupCommand } from './unbind-variable-group.command';

export function registerVariableCommands(program: Command, dependencies: CliCommandDependencies): void {
  const variableCommand: Command = program.command('variable').description('Runtime variable commands');
  registerBindVariableGroupCommand(variableCommand, dependencies);
  registerVariableGroupCommands(variableCommand, dependencies);
  registerImportVariableCommand(variableCommand, dependencies);
  registerListVariableCommand(variableCommand, dependencies);
  registerShowVariableCommand(variableCommand, dependencies);
  registerSetVariableCommand(variableCommand, dependencies);
  registerUnbindVariableGroupCommand(variableCommand, dependencies);
  registerRemoveVariableCommand(variableCommand, dependencies);
  registerRunVariableCommand(variableCommand, dependencies);
}
