import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerCreateGroupCommand } from './group-create.command';
import { registerDeleteGroupCommand } from './group-delete.command';
import { registerGroupMemberCommands } from './group-member.commands';
import { registerListGroupCommand } from './group-list.command';

export function registerGroupCommands(program: Command, dependencies: CliCommandDependencies): void {
  const groupCommand: Command = program.command('group').description('Organization access groups');
  registerListGroupCommand(groupCommand, dependencies);
  registerCreateGroupCommand(groupCommand, dependencies);
  registerDeleteGroupCommand(groupCommand, dependencies);
  registerGroupMemberCommands(groupCommand, dependencies);
}
