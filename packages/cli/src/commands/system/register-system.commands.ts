import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerDomainSystemCommands } from './domain.command';
import { registerIssuePasswordResetSystemCommand } from './issue-password-reset.command';

export function registerSystemCommands(program: Command, dependencies: CliCommandDependencies): void {
  const system: Command = program.command('system').description('Kubernetes platform operator commands');
  registerDomainSystemCommands(system, dependencies);
  registerIssuePasswordResetSystemCommand(system, dependencies);
}
