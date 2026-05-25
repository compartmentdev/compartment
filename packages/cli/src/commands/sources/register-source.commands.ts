import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerSourceConnectGitCommand } from './source-connect-git.command';
import { registerSourceDisconnectCommand } from './source-disconnect.command';
import { registerSourceExcludeCommand } from './source-exclude.command';
import { registerSourceIncludeCommand } from './source-include.command';
import { registerSourceListCommand } from './source-list.command';
import { registerSourceSettingsCommands } from './source-settings.command';
import { registerSourceShowCommand } from './source-show.command';
import { registerSourceSyncCommand } from './source-sync.command';

export function registerSourceCommands(program: Command, dependencies: CliCommandDependencies): void {
  const sourceCommand: Command = program.command('source').description('Git source commands');
  const connectCommand: Command = sourceCommand.command('connect').description('Connect a source');

  registerSourceConnectGitCommand(connectCommand, dependencies);
  registerSourceDisconnectCommand(sourceCommand, dependencies);
  registerSourceExcludeCommand(sourceCommand, dependencies);
  registerSourceIncludeCommand(sourceCommand, dependencies);
  registerSourceListCommand(sourceCommand, dependencies);
  registerSourceSettingsCommands(sourceCommand, dependencies);
  registerSourceShowCommand(sourceCommand, dependencies);
  registerSourceSyncCommand(sourceCommand, dependencies);
}
