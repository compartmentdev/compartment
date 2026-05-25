import type { Command } from 'commander';
import type { AccessRoleResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { updateOrganizationAccessRole } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { parsePermissionKeys } from '../role.command.helpers';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

interface RoleUpdateCommandOptions extends OutputOnlyOptions {
  name?: string | undefined;
  permission?: string[] | undefined;
}

export function registerUpdateRoleCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('update <roleId>')
      .option('--name <name>')
      .option('--permission <key...>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (roleId: string, options: RoleUpdateCommandOptions): Promise<void> => {
    const response: AccessRoleResponse = await updateOrganizationAccessRole(
      await createRemoteAuthenticatedContext(options),
      roleId,
      {
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.permission === undefined ? {} : { permissionKeys: parsePermissionKeys(options.permission) }),
      },
    );

    renderOutput(dependencies.io, options.output, response, `Updated role ${response.role.name}.`);
  });
}
