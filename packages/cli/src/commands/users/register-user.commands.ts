import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerBlockUserCommand } from './block-user.command';
import { registerInviteUserCommand } from './invite-user.command';
import { registerListUsersCommand } from './list-users.command';
import { registerRemoveUserCommand } from './remove-user.command';
import { registerUnblockUserCommand } from './unblock-user.command';

export function registerUserCommands(program: Command, dependencies: CliCommandDependencies): void {
  const userCommand: Command = program.command('user').description('Organization membership and direct user access');
  registerListUsersCommand(userCommand, dependencies);
  registerInviteUserCommand(userCommand, dependencies);
  registerBlockUserCommand(userCommand, dependencies);
  registerUnblockUserCommand(userCommand, dependencies);
  registerRemoveUserCommand(userCommand, dependencies);
}
