import type { Command } from 'commander';
import type { AccessGroupListResponse, AccessGroupListRow } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listOrganizationAccessGroups } from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerListGroupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      const response: AccessGroupListResponse = await listOrganizationAccessGroups(
        await createRemoteAuthenticatedContext(options),
      );
      const text: string =
        response.groups.length === 0 ? 'No groups found.' : response.groups.map(formatGroupRow).join('\n');

      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}

function formatGroupRow(group: AccessGroupListRow): string {
  const description: string = group.description ?? 'no-description';
  const access: string = group.assignedRoleNames.length === 0 ? 'no-assignments' : group.assignedRoleNames.join(',');
  const scope: string = group.assignmentScopeLabels.length === 0 ? 'no-scopes' : group.assignmentScopeLabels.join(',');

  return `${group.id}\t${group.name}\t${group.memberCount} members\t${access}\t${scope}\t${description}`;
}
