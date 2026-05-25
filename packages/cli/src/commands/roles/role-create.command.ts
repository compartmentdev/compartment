import type { Command } from 'commander';
import type { AccessRoleResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createOrganizationAccessRole } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { parsePermissionKeys } from '../role.command.helpers';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

interface RoleCreateCommandOptions extends OutputOnlyOptions {
  permission?: string[] | undefined;
}

export function registerCreateRoleCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('create <name>')
      .option('--permission <key...>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (name: string, options: RoleCreateCommandOptions): Promise<void> => {
    const response: AccessRoleResponse = await createOrganizationAccessRole(
      await createRemoteAuthenticatedContext(options),
      {
        name,
        permissionKeys: parsePermissionKeys(options.permission ?? []),
      },
    );

    renderOutput(dependencies.io, options.output, response, `Created role ${response.role.name}.`);
  });
}
