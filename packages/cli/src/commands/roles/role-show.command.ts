import type { Command } from 'commander';
import type { AccessRoleResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { showOrganizationAccessRole } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerShowRoleCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('show <roleId>').option('--output <format>', 'text or json', 'text')).action(
    async (roleId: string, options: OutputOnlyOptions): Promise<void> => {
      const response: AccessRoleResponse = await showOrganizationAccessRole(
        await createRemoteAuthenticatedContext(options),
        roleId,
      );
      const text: string = `${response.role.name} (${response.role.kind})
Permissions: ${response.role.permissionKeys.join(', ')}`;

      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}
