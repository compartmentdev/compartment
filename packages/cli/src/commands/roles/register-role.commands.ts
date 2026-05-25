import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerCreateRoleCommand } from './role-create.command';
import { registerDeleteRoleCommand } from './role-delete.command';
import { registerListRoleCommand } from './role-list.command';
import { registerShowRoleCommand } from './role-show.command';
import { registerUpdateRoleCommand } from './role-update.command';

export function registerRoleCommands(program: Command, dependencies: CliCommandDependencies): void {
  const roleCommand: Command = program.command('role').description('Organization access roles');
  registerListRoleCommand(roleCommand, dependencies);
  registerShowRoleCommand(roleCommand, dependencies);
  registerCreateRoleCommand(roleCommand, dependencies);
  registerUpdateRoleCommand(roleCommand, dependencies);
  registerDeleteRoleCommand(roleCommand, dependencies);
}
