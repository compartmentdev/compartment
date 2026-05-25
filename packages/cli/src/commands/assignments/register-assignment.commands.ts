import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerCreateAssignmentCommand } from './assignment-create.command';
import { registerDeleteAssignmentCommand } from './assignment-delete.command';
import { registerListAssignmentCommand } from './assignment-list.command';

export function registerAssignmentCommands(program: Command, dependencies: CliCommandDependencies): void {
  const assignmentCommand: Command = program.command('assignment').description('Scoped access assignments');
  registerListAssignmentCommand(assignmentCommand, dependencies);
  registerCreateAssignmentCommand(assignmentCommand, dependencies);
  registerDeleteAssignmentCommand(assignmentCommand, dependencies);
}
