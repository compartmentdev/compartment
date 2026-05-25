import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerListRemotesCommand } from './list-remotes.command';
import { registerRemoveRemoteCommand } from './remove-remote.command';
import { registerUseRemoteCommand } from './use-remote.command';

export function registerRemoteCommands(program: Command, dependencies: CliCommandDependencies): void {
  const remoteCommand: Command = program.command('remote').description('Remote profile commands');
  registerListRemotesCommand(remoteCommand, dependencies);
  registerUseRemoteCommand(remoteCommand, dependencies);
  registerRemoveRemoteCommand(remoteCommand, dependencies);
}
