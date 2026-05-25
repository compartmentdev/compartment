import type { Command } from 'commander';
import { readFriendlyAccessSummary, type AccessRoleListResponse, type AccessRoleListRow } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listOrganizationAccessRoles } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerListRoleCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      const response: AccessRoleListResponse = await listOrganizationAccessRoles(
        await createRemoteAuthenticatedContext(options),
      );
      const text: string =
        response.roles.length === 0 ? 'No roles found.' : response.roles.map(formatRoleRow).join('\n');

      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}

function formatRoleRow(role: AccessRoleListRow): string {
  const description: string = role.description ?? 'no-description';
  const usage: string =
    role.groupCount > 0 || role.principalCount > 0
      ? `${role.groupCount} groups, ${role.principalCount} users`
      : `${role.assignmentCount} assignments`;

  return `${role.id}\t${role.name}\t${role.kind}\t${readFriendlyAccessSummary(role.permissionKeys).toLowerCase()}\t${usage}\t${description}`;
}
