import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerAuthSettingsCommands } from './auth-settings.command';

export function registerAuthCommands(program: Command, dependencies: CliCommandDependencies): void {
  const authCommand: Command = program.command('auth').description('Authentication configuration');
  registerAuthSettingsCommands(authCommand, dependencies);
}
