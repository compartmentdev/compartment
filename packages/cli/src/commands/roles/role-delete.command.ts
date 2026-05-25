import type { Command } from 'commander';
import type { AccessRoleResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { deleteOrganizationAccessRole } from '../../services/rbac.service';
import type { CliCommandDependencies, ConfirmedOutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

const missingRoleDeleteConfirmationMessage: string = 'Role delete requires --yes.';

export function registerDeleteRoleCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('delete <roleId>')
      .option('--output <format>', 'text or json', 'text')
      .option('--yes', 'confirm role deletion'),
  ).action(async (roleId: string, options: ConfirmedOutputOnlyOptions): Promise<void> => {
    if (options.yes !== true) {
      throw new Error(missingRoleDeleteConfirmationMessage);
    }

    const response: AccessRoleResponse = await deleteOrganizationAccessRole(
      await createRemoteAuthenticatedContext(options),
      roleId,
    );

    renderOutput(dependencies.io, options.output, response, `Deleted role ${response.role.name}.`);
  });
}
