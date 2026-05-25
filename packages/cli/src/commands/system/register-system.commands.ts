import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerDomainSystemCommand } from './domain.command';
import { registerIssuePasswordResetSystemCommand } from './issue-password-reset.command';
import { registerRestartSystemCommand } from './restart.command';
import { registerStatusSystemCommand } from './status.command';
import { registerUpdateSystemCommand } from './update.command';

export function registerSystemCommands(program: Command, dependencies: CliCommandDependencies): void {
  const systemCommand: Command = program.command('system').description('Self-hosted platform maintenance commands');
  registerIssuePasswordResetSystemCommand(systemCommand, dependencies);
  registerDomainSystemCommand(systemCommand, dependencies);
  registerUpdateSystemCommand(systemCommand, dependencies);
  registerStatusSystemCommand(systemCommand, dependencies);
  registerRestartSystemCommand(systemCommand, dependencies);
}
