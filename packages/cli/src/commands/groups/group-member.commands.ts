import type { Command } from 'commander';
import type { AccessGroupMemberListResponse, AccessGroupMemberSummary } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import {
  addOrganizationAccessGroupMember,
  listOrganizationAccessGroupMembers,
  removeOrganizationAccessGroupMember,
} from '../../services/rbac.service';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerGroupMemberCommands(program: Command, dependencies: CliCommandDependencies): void {
  const memberCommand: Command = program.command('member').description('Group membership');
  registerListGroupMembersCommand(memberCommand, dependencies);
  registerAddGroupMemberCommand(memberCommand, dependencies);
  registerRemoveGroupMemberCommand(memberCommand, dependencies);
}

function formatMemberRow(member: AccessGroupMemberSummary): string {
  return `${member.id}\t${member.email}\t${member.status}`;
}

function registerListGroupMembersCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list <groupId>').option('--output <format>', 'text or json', 'text')).action(
    async (groupId: string, options: OutputOnlyOptions): Promise<void> => {
      const response: AccessGroupMemberListResponse = await listOrganizationAccessGroupMembers(
        await createRemoteAuthenticatedContext(options),
        groupId,
      );
      const text: string =
        response.members.length === 0 ? 'No group members found.' : response.members.map(formatMemberRow).join('\n');

      renderOutput(dependencies.io, options.output, response, text);
    },
  );
}

function registerAddGroupMemberCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('add <groupId> <email>').option('--output <format>', 'text or json', 'text')).action(
    async (groupId: string, email: string, options: OutputOnlyOptions): Promise<void> => {
      const response: AccessGroupMemberListResponse = await addOrganizationAccessGroupMember(
        await createRemoteAuthenticatedContext(options),
        groupId,
        { email },
      );

      renderOutput(dependencies.io, options.output, response, `Added ${email} to ${groupId}.`);
    },
  );
}

function registerRemoveGroupMemberCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program.command('remove <groupId> <email>').option('--output <format>', 'text or json', 'text'),
  ).action(async (groupId: string, email: string, options: OutputOnlyOptions): Promise<void> => {
    const response: AccessGroupMemberListResponse = await removeOrganizationAccessGroupMember(
      await createRemoteAuthenticatedContext(options),
      groupId,
      email,
    );

    renderOutput(dependencies.io, options.output, response, `Removed ${email} from ${groupId}.`);
  });
}
