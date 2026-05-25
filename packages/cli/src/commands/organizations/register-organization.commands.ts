import type { Command } from 'commander';
import type { CliCommandDependencies } from '../command.types';
import { registerCreateOrganizationCommand } from './create-organization.command';
import { registerListOrganizationsCommand } from './list-organizations.command';
import { registerOrganizationSettingsCommands } from './organization-settings.command';
import { registerUseOrganizationCommand } from './use-organization.command';

export function registerOrganizationCommands(program: Command, dependencies: CliCommandDependencies): void {
  const organizationCommand: Command = program
    .command('org')
    .description('Organization selection and context commands');
  registerCreateOrganizationCommand(organizationCommand, dependencies);
  registerListOrganizationsCommand(organizationCommand, dependencies);
  registerOrganizationSettingsCommands(organizationCommand, dependencies);
  registerUseOrganizationCommand(organizationCommand, dependencies);
}
