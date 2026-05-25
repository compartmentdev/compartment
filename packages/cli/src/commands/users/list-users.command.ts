import type { Command } from 'commander';
import type { OrganizationUserListRow, UserListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { listOrganizationUsers } from '../../services/organization-users.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, ListCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import {
  addListPaginationOptions,
  createPaginationHint,
  readListCommandPagination,
  type ResolvedListCommandPagination,
} from '../list-pagination.command';
import { readOrganizationUserRoleLabel } from './organization-user-role-label';

export function registerListUsersCommand(program: Command, dependencies: CliCommandDependencies): void {
  const command: Command = addRemoteOption(
    program
      .command('list')
      .description('List organization users and system automation accounts.')
      .option('--output <format>', 'text or json', 'text'),
  );

  addListPaginationOptions(command).action(async (options: ListCommandOptions): Promise<void> => {
    assertValidRemoteOption(options);
    const config: CliConfig = await readCliConfig();
    const pagination: ResolvedListCommandPagination = readListCommandPagination(options);
    const response: UserListResponse = await listOrganizationUsers(
      await createAuthenticatedContext(config, {
        cwd: process.cwd(),
        remoteName: options.remote,
      }),
      pagination,
    );
    const text: string = createUserListMessage(response);

    renderOutput(dependencies.io, options.output, response, text);
  });
}

function createUserListMessage(response: UserListResponse): string {
  if (response.users.length === 0) {
    return 'No users found.';
  }

  const lines: string[] = response.users.map((user: OrganizationUserListRow): string => formatUserRow(user));
  const paginationHint: string | null = createPaginationHint({
    itemName: 'users',
    pagination: response.pagination,
  });
  if (paginationHint !== null) {
    lines.push(paginationHint);
  }

  return lines.join('\n');
}

function formatUserRow(user: OrganizationUserListRow): string {
  const groupSummary: string = user.groupNames.length === 0 ? 'no-groups' : user.groupNames.join(',');
  const directAccessSummary: string =
    user.directAccessScopeLabels.length === 0 ? 'no-direct-access' : user.directAccessScopeLabels.join(',');

  return `${user.email}\t${user.type}\t${readOrganizationUserRoleLabel(user)}\t${groupSummary}\t${directAccessSummary}\t${user.status}\t${user.access}`;
}
